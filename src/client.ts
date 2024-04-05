const unpackData = (array: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(array.reverse().map((v) => ~v & 0xff)));

const packData = <T = any>(data: T) => {
  return new TextEncoder()
    .encode(JSON.stringify(data))
    .map((v) => ~v & 0xff)
    .reverse();
};

class Tracker {
  static readonly UID_KEY = "t";
  static tracker?: Tracker;
  static isBlur = false;

  static init() {
    window.addEventListener("blur", () => {
      Tracker.isBlur = true;
      Tracker.tracker!.record("blur");
    });
    window.addEventListener("focus", () => {
      Tracker.isBlur = false;
      Tracker.tracker!.record("focus");
    });
    window.addEventListener("popstate", () => {
      Tracker.tracker!.recordView();
    });
    return Tracker.tracker || (Tracker.tracker = new Tracker());
  }

  readonly ws: WebSocket;
  closed: boolean = false;

  get uid() {
    return localStorage.getItem(Tracker.UID_KEY) || "";
  }
  set uid(v: string) {
    localStorage.setItem(Tracker.UID_KEY, v);
  }

  constructor() {
    Tracker.tracker = this;
    const ws = new WebSocket(`wss://space.cch137.link/${this.uid || ""}`);
    // const ws = new WebSocket(`ws://localhost:4000/${this.uid}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.closed) return ws.close();
      // send heartbeats
      // console.time("heartbeat");
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState !== ws.OPEN) {
          clearInterval(heartbeatInterval);
          return;
        }
        // console.timeEnd("heartbeat");
        // console.time("heartbeat");
        ws.send(new Uint8Array([0]));
      }, 1000);
    });

    ws.addEventListener("message", async (ev) => {
      // parse command pack from server
      const { cmd, ...data } = unpackData(
        new Uint8Array(await (ev.data as Blob).arrayBuffer())
      ) as { cmd: string; [key: string]: any };
      // execute command
      switch (cmd) {
        case "uid": {
          this.uid = data.uid;
          break;
        }
        case "view": {
          this.recordView();
          break;
        }
        case "close": {
          ws.close();
          break;
        }
      }
    });

    ws.addEventListener("error", (ev) => {
      console.error(ev);
      ws.close();
    });

    ws.addEventListener("close", () => {
      if (this.closed) return;
      this.closed = true;
      const itv = setInterval(() => {
        if (Tracker.isBlur) return;
        clearInterval(itv);
        Tracker.tracker = new Tracker();
      }, 1000);
    });
  }

  record(type: string, data: Record<string, any> = {}) {
    const { ws } = Tracker.tracker!;
    if (ws.readyState !== ws.OPEN) {
      const sending = () => {
        Tracker.tracker!.record(type, data);
        ws.removeEventListener("open", sending);
      };
      ws.addEventListener("open", sending);
      return;
    }
    ws.send(packData({ ...data, type }));
  }

  recordView() {
    Tracker.tracker!.record("view", { href: location.href });
  }
}
