import mongoose from "mongoose";

import net from "./lib/net";
import env from "./lib/env";
import Logger from "./lib/logger";

env();

const V_TAG = "2";
const UID_LENGTH = 16;
const SID_LENGTH = 16;
const PORT = Number(process.env.PORT) || 4000;

mongoose
  .connect(process.env.MONGODB_URI!)
  .then(() => console.log("connected to MongoDB"))
  .catch(() => console.error("failed to connect to MongoDB"));

const Tracks = mongoose.connection.collection("tracks");
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
      block: {
        type: Boolean,
        required: true,
      },
      wl: {
        type: Boolean,
        required: true,
      },
    },
    { versionKey: false }
  ),
  "users",
  { overwriteModels: true }
);

const generate64BitId = (length: number): string => {
  const charset: string =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
  const charsetLength: number = charset.length;
  let result: string = "";
  for (let i: number = 0; i < length; i++) {
    const randomIndex: number = Math.floor(Math.random() * charsetLength);
    result += charset[randomIndex];
  }
  return result;
};

async function getUser(uid: string) {
  if (!uid) return { exists: false, block: false };
  const user = await User.findOne({ uid });
  if (!user) return { exists: false, block: false };
  return { exists: true, block: !user.wl && user.block };
}

async function getBlockedIps() {
  return new Set(
    [...(await User.find({ block: true, wl: false }))].map((u) => u.ip).flat()
  );
}

async function generateUser() {
  const uid = generate64BitId(UID_LENGTH);
  if ((await getUser(uid)).exists) return generateUser();
  const user = await User.create({
    uid,
    ip: [],
    ua: [],
    block: false,
    wl: false,
  });
  return user;
}

async function blockUser(uid: string) {
  return await User.updateOne({ uid }, { block: true });
}

async function whitelistUser(uid: string) {
  return await User.updateOne({ uid }, { wl: true });
}

const unpackData = (array: Buffer) =>
  JSON.parse(new TextDecoder().decode(array.reverse().map((v) => ~v & 0xff)));

const packData = <T = any>(data: T) =>
  typeof Buffer === "undefined"
    ? new TextEncoder()
        .encode(JSON.stringify(data))
        .map((v) => ~v & 0xff)
        .reverse()
    : Buffer.from(JSON.stringify(data))
        .map((v) => ~v & 0xff)
        .reverse();

const packCommand = (cmd: string, data: { [key: string]: any } = {}) =>
  packData({ cmd, ...data });

const server = net.createServer((socket) => {
  let uid = "";
  const sid = generate64BitId(SID_LENGTH);

  const record = (
    type: string = "unknown",
    data: { [key: string]: any } = {}
  ) => {
    delete data.uid;
    delete data.sid;
    delete data.type;
    delete data.t;
    Tracks.insertOne({ uid, sid, type, t: new Date(), ...data });
  };

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
    const { exists: isExists, block: isBlockedUid } = await getUser(_uid);
    uid = isExists ? _uid : (await generateUser()).uid;
    if (!isExists) socket.send(packCommand("uid", { uid }));

    const isFromLineAppBrowser = /Line\//.test(ua);
    const isFromFBInAppBrowser = /FB_IAB\//.test(ua);
    const isFromIPhone = /iPhone;/.test(ua);
    const isFromIPad = /iPad;/.test(ua);
    if (isFromLineAppBrowser) socket.send(packCommand("from-line"));
    if (isFromFBInAppBrowser) socket.send(packCommand("from-fbiab"));
    if (isFromIPhone) socket.send(packCommand("from-iphone"));
    if (isFromIPad) socket.send(packCommand("from-ipad"));

    if (isBlockedUid) {
      socket.send(packCommand("block"));
    } else {
      socket.send(packCommand("welcome"));
      getBlockedIps().then((ips) => {
        if (ips.has(ip)) blockUser(uid);
      });
    }
    Logger.info(`[${uid}] connected`);
    socket.send(packCommand("conn"));
    await Promise.all([
      record("conn", { ip, ua }),
      User.updateOne({ uid }, { $addToSet: { ip, ua } }),
    ]);
  });

  socket.on("message", async (_data) => {
    // skip heartbeat
    if (_data instanceof Buffer && _data.length === 1 && _data[0] === 0) return;
    if (typeof _data === "string") {
      Logger.info(`[${uid}] sent:`, _data);
      return record("message", { message: _data });
    }
    try {
      const { type, ...data } = unpackData(_data);
      switch (type) {
        case "view2": {
          return await socket.send(
            packCommand((await getUser(uid)).block ? "block" : "welcome")
          );
        }
        case "block": {
          socket.send(packCommand("block"));
          blockUser(uid);
          return;
        }
        case "wl": {
          socket.send(packCommand("welcome"));
          whitelistUser(uid);
          return;
        }
        case "known-text-ans": {
          const knownTextAns = await Tracks.findOne({
            uid,
            type: "view",
            href: /\/apps\/ncu\/text-ans/,
          });
          if (Boolean(knownTextAns)) return;
          socket.send(packCommand("block"));
          blockUser(uid);
          return;
        }
        default: {
          Logger.info(`[${uid}] tracked:`, type, data);
          record(type, data);
        }
      }
    } catch {
      Logger.info(`[${uid}] sent an unusual message:`, _data);
    }
  });

  socket.on("close", () => {
    if (uid) {
      record("disconn");
      Logger.info(`[${uid}] disconnected`);
    } else {
      Tracks.deleteMany({ sid });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

process.on("uncaughtException", console.error);
