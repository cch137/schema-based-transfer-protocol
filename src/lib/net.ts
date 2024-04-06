import * as net from "net";
import { createHash } from "crypto";

const DEFAULT_TIMEOUT = 10000;
const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type THeaders = { [name: string]: string | undefined };

declare module "net" {
  interface Socket {
    upgraded?: boolean;
    send(payload: Buffer | Uint8Array | string): Promise<void>;
    on(event: "message", listener: (data: Buffer | string) => void): this;
    on(
      event: "upgrade",
      listener: (req: { headers: THeaders; body: Buffer }) => void
    ): this;
  }
}

export const paresChunk = (chunk: Buffer) => {
  let isRequestLine = true;
  const headers: THeaders = {};
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
    let buffer: Buffer = Buffer.alloc(0);
    socket.setTimeout(options.timeout);
    socket.on("data", (chunk) => {
      socket.setTimeout(options.timeout);

      const { headers, body } = socket.upgraded
        ? { headers: {}, body: chunk }
        : paresChunk(chunk);

      if (options.allowHTTP) {
        if (!socket.upgraded) {
          if (headers["Upgrade"] !== "websocket") {
            socket.write("HTTP/1.1 200 OK\r\n\r\nOK", () => socket.end());
            return;
          }
          const wsKey =
            headers["Sec-WebSocket-Key"] || headers["Sec-Websocket-Key"];
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
            socket.emit("upgrade", { headers, body });
          });
          return;
        }

        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const fin = (buffer[0] & 0x80) === 0x80;
          const opcode = buffer[0] & 0x0f;
          let payloadLength = buffer[1] & 0x7f;
          let payloadStart = 2;
          if (payloadLength === 126) {
            payloadLength = buffer.readUInt16BE(2);
            payloadStart = 4;
          } else if (payloadLength === 127) {
            payloadLength = buffer.readUInt32BE(2);
            payloadStart = 6;
          }
          if (buffer.length < payloadStart + payloadLength) {
            break;
          }
          const mask = buffer.subarray(payloadStart, payloadStart + 4);
          const payload = buffer.subarray(
            payloadStart + 4,
            payloadStart + 4 + payloadLength
          );
          const decodedPayload = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) {
            decodedPayload[i] = payload[i] ^ mask[i % 4];
          }
          socket.emit("message", decodedPayload);
          buffer = buffer.subarray(payloadStart + 4 + payloadLength);
        }

        return;
      }
    });
    socket.on("timeout", () => socket.end());
    listener!(socket);
  });
}

export { createServer };

net.Socket.prototype.send = function (payload: Buffer | Uint8Array | string) {
  return new Promise<void>((resolve, reject) => {
    if (!this.upgraded) throw new Error("Socket is not ready");
    const isBuffer = Buffer.isBuffer(payload);
    const opcode = isBuffer ? 2 : 1;
    payload = isBuffer ? payload : Buffer.from(payload);
    const length = payload.length;
    const buffer = Buffer.alloc(length + 2);
    buffer[0] = 0b10000000 | opcode;
    buffer[1] = length;
    (payload as Buffer).copy(buffer, 2);
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
