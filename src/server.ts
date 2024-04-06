import mongoose from "mongoose";

import net from "./lib/net";
import env from "./lib/env";
import Logger from "./lib/logger";

env();

const unpackData = (array: Buffer) =>
  JSON.parse(new TextDecoder().decode(array.reverse().map((v) => ~v & 0xff)));

export const packData = <T = any>(data: T) =>
  typeof Buffer === "undefined"
    ? new TextEncoder()
        .encode(JSON.stringify(data))
        .map((v) => ~v & 0xff)
        .reverse()
    : Buffer.from(JSON.stringify(data))
        .map((v) => ~v & 0xff)
        .reverse();

const V_TAG = "1";
const UID_LENGTH = 16;
const SID_LENGTH = 16;

mongoose
  .connect(process.env.MONGODB_URI!)
  .then(() => console.log("connected to MongoDB"))
  .catch(() => console.error("failed to connect to MongoDB"));

const db = {
  collection: (name: string) => mongoose.connection.collection(name),
  get users() {
    return db.collection("users");
  },
  get tracks() {
    return db.collection("tracks");
  },
};

function generate64BitId(length: number): string {
  const charset: string =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
  const charsetLength: number = charset.length;
  let result: string = "";
  for (let i: number = 0; i < length; i++) {
    const randomIndex: number = Math.floor(Math.random() * charsetLength);
    result += charset[randomIndex];
  }
  return result;
}

async function uidIsExist(uid: string) {
  return Boolean(uid) && Boolean(await db.users.findOne({ uid }));
}

async function generateUser() {
  const uid = generate64BitId(UID_LENGTH);
  if (await uidIsExist(uid)) return generateUser();
  return await User.create({ uid, ip: [], ua: [] });
}

const User = mongoose.model(
  "User",
  new mongoose.Schema(
    {
      uid: {
        type: String,
        required: true,
      },
      ip: {
        type: [String],
        required: true,
      },
      ua: {
        type: [String],
        required: true,
      },
    },
    { versionKey: false }
  ),
  "users",
  { overwriteModels: true }
);

const packCommand = (cmd: string, data: { [key: string]: any } = {}) =>
  packData({ cmd, ...data });

const addTrack = (
  uid: string,
  sid: string,
  type: string = "unknown",
  data: { [key: string]: any } = {}
) => {
  delete data.uid;
  delete data.sid;
  delete data.type;
  delete data.t;
  db.tracks.insertOne({ uid, sid, type, t: new Date(), ...data });
};

const server = net.createServer((socket) => {
  let uid = "";
  const sid = generate64BitId(SID_LENGTH);

  const record = (type?: string, data?: { [key: string]: any }) =>
    addTrack(uid, sid, type, data);

  socket.on("upgrade", async ({ headers, body }) => {
    const [_, vTag, _uid] = (headers[":path:"] || "").split("/");
    if (vTag !== V_TAG) {
      await socket.send(packCommand("v-err"));
      socket.end();
      return;
    }
    const ip =
      headers["Cf-Connecting-Ip"] ||
      (headers["X-Forwarded-For"] || "").split(",")[0].trim() ||
      socket.remoteAddress ||
      "unknown";
    const ua = headers["User-Agent"] || headers["user-agent"] || "unknown";
    const isExist = await uidIsExist(_uid);
    uid = isExist ? _uid : (await generateUser()).uid;
    if (!isExist) socket.send(packCommand("uid", { uid }));
    Logger.info(`[${uid}] connected`);
    socket.send(packCommand("conn"));
    await Promise.all([
      record("conn", { ip, ua }),
      User.updateOne({ uid }, { $addToSet: { ip, ua } }),
    ]);
  });

  socket.on("message", (_data) => {
    // skip heartbeat
    if (_data instanceof Buffer && _data.length === 1 && _data[0] === 0) return;
    if (typeof _data === "string") {
      Logger.info(`[${uid}] sent:`, _data);
      return record("message", { message: _data });
    }
    try {
      const { type, ...data } = unpackData(_data);
      Logger.info(`[${uid}] tracked:`, type, data);
      record(type, data);
    } catch {
      Logger.info(`[${uid}] sent an unusual message:`, _data);
    }
  });

  socket.on("end", () => {
    if (uid) {
      record("disconn");
      Logger.info(`[${uid}] disconnected`);
    } else {
      db.tracks.deleteMany({ sid });
    }
  });
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

process.on("uncaughtException", console.error);
