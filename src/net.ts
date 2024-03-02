import * as net from "net";
import { createHash } from "crypto";

const DEFAULT_TIMEOUT = 10000;
const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

declare module "net" {
  interface Socket {
    upgraded?: boolean;
    send(payload: Buffer | string): Promise<void>;
    on(event: "message", listener: (data: Buffer | string) => void): this;
    on(event: "upgrade", listener: (data: Buffer) => void): this;
  }
}

export const paresHeaders = (chunk: Buffer) => {
  let isRequestLine = true;
  const headers: { [name: string]: string | undefined } = {};
  const size = chunk.length;
  if (size < 4) return { headers, body: chunk };
  let i = 0;
  let j = 0;
  while (j < size) {
    for (; j < size; j++) {
      if (chunk[j] === 13 && chunk[j + 1] === 10) {
        const header = chunk.subarray(i, j).toString();
        i = j + 2;
        if (chunk[j + 2] === 13 && chunk[j + 3] === 10) {
          i = j + 4;
          j = size;
          break;
        } else {
          j += 2;
        }
        if (isRequestLine) {
          const [method, path, protocol] = header.split(/\s/g);
          headers[":method:"] = method;
          headers[":path:"] = path;
          headers[":protocol:"] = protocol;
          isRequestLine = false;
          break;
        }
        const [name, value] = header.split(": ");
        headers[name] = value;
      }
    }
  }
  return {
    headers,
    body: i === 0 ? chunk : chunk.subarray(i),
  };
};

const unmask = (buffer: Buffer, mask: Buffer) => {
  for (let i = 0; i < buffer.length; i++) buffer[i] ^= mask[i % 4];
  return buffer;
};

const getLength = (buffer: Buffer) => {
  const byte = buffer.readUInt8(0);
  const str = byte.toString(2);
  const length = parseInt(str.substring(1), 2);
  if (length < 125) return length;
  if (length === 126) return buffer.readUInt16BE(1);
  return Number(buffer.readBigUInt64BE(1));
};

const handleChunk = (
  options: ServerOpts<true>,
  socket: net.Socket,
  chunk: Buffer,
  prevPayloads: Buffer[]
) => {
  socket.setTimeout(options.timeout);

  const { headers, body } = paresHeaders(chunk);

  if (options.allowHTTP) {
    if (headers["Upgrade"] === "websocket") {
      const wsKey = headers["Sec-WebSocket-Key"];
      if (!wsKey) return;
      const accepted = createHash("sha1")
        .update(wsKey + WS_MAGIC_STRING)
        .digest("base64");
      const response = [
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Sec-WebSocket-Accept: ${accepted}`,
        "\r\n",
      ].join("\r\n");
      socket.write(response, (err) => {
        if (err) return;
        socket.upgraded = true;
        socket.emit("upgrade", body);
      });
      return;
    }

    if (!socket.upgraded) return;

    const FIN = (chunk[0] & 0b10000000) === 0b10000000; // is finish?
    const opcode = chunk[0] & 0b00001111; // operation code
    const masked = (chunk[1] & 0b10000000) === 0b10000000;
    const payloadLenght = getLength(chunk.subarray(1));
    const _payload = masked
      ? unmask(chunk.subarray(6, 6 + payloadLenght), chunk.subarray(2, 6))
      : chunk.subarray(6, 6 + payloadLenght);
    if (!FIN) {
      prevPayloads.push(_payload);
      return;
    }
    const payload =
      prevPayloads.length === 0
        ? _payload
        : Buffer.concat([...prevPayloads.splice(0), _payload]);
    switch (opcode) {
      case 1:
        socket.emit("message", payload.toString("utf8"));
        break;
      case 2:
        socket.emit("message", payload);
        break;
      default:
        break;
    }

    return;
  }
};

type ServerOptsExt = {
  timeout: number;
  allowHTTP: boolean;
};

export type ServerOpts<Inited extends boolean = false> = net.ServerOpts &
  (Inited extends true ? ServerOptsExt : Partial<ServerOptsExt>);

function createServer(
  connectionListener?: (socket: net.Socket) => void
): net.Server;
function createServer(
  options?: ServerOpts,
  connectionListener?: (socket: net.Socket) => void
): net.Server;
function createServer(
  _options: ServerOpts<false> | ((socket: net.Socket) => void) = {},
  listener?: (socket: net.Socket) => void
) {
  if (typeof _options === "function") (listener = _options), (_options = {});
  if (typeof listener !== "function") listener = () => {};
  const options: ServerOpts<true> = {
    timeout: DEFAULT_TIMEOUT,
    allowHTTP: true,
    ..._options,
  };
  return net.createServer(options, (socket) => {
    const payloads: Buffer[] = [];
    socket.setTimeout(options.timeout);
    socket.on("data", (chunk) => handleChunk(options, socket, chunk, payloads));
    socket.on("timeout", () => socket.end());
    listener!(socket);
  });
}

export { createServer };

net.Socket.prototype.send = function (payload: Buffer | string) {
  return new Promise<void>((resolve, reject) => {
    if (!this.upgraded) throw new Error("Socket is not ready");
    const opcode = Buffer.isBuffer(payload) ? 2 : 1;
    payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const length = payload.length;
    const buffer = Buffer.alloc(length + 2);
    buffer[0] = 0b10000000 | opcode;
    buffer[1] = length;
    payload.copy(buffer, 2);
    this.write(buffer, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

export * from "net";
export default new Proxy(net, {
  get(t: any, p) {
    if (p === "createServer") return createServer;
    return t[p];
  },
  set(t, p, v) {
    t[p] = v;
    return true;
  },
}) as typeof net;
