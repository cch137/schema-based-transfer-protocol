import mongoose from "mongoose";
import net from "./lib/net.js";
import { logMessage } from "./utils/console.js";
import { packData, unpackData } from "./utils/packing.js";
import { config as dotenv } from "dotenv";

const UID_LENGTH = 16;
const SID_LENGTH = 16;

dotenv();
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
  logMessage("client connected");

  let uid = "";
  const sid = generate64BitId(SID_LENGTH);

  const record = (type?: string, data?: { [key: string]: any }) =>
    addTrack(uid, sid, type, data);

  socket.on("upgrade", async ({ headers, body }) => {
    logMessage("client is upgradeted");
    const ua = headers["User-Agent"] || "unknown";
    const ip = socket.remoteAddress || "unknown";
    const _uid = (headers[":path:"] || "").substring(1);
    const isExist = await uidIsExist(_uid);
    uid = isExist ? _uid : (await generateUser()).uid;
    if (!isExist) socket.send(packCommand("uid", { uid }));
    socket.send(packCommand("view"));
    await Promise.all([
      record("conn", { ip, ua }),
      User.updateOne({ uid }, { $addToSet: { ip, ua } }),
    ]);
  });

  socket.on("message", (_data) => {
    // skip heartbeat
    if (_data instanceof Buffer && _data.length === 1 && _data[0] === 0) return;
    logMessage("client sent:", _data);
    if (typeof _data === "string") return record("message", { message: _data });
    const { type, ...data } = unpackData(_data);
    record(type, data);
  });

  socket.on("end", () => {
    logMessage("client disconnected");
    if (uid) record("disconn");
    else db.tracks.deleteMany({ sid });
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
