export const unpackData = (array: Uint8Array | Buffer) =>
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
