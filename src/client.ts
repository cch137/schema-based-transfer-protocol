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
  static currentHref = "";

  static init() {
    window.addEventListener("blur", () => {
      Tracker.isBlur = true;
      Tracker.tracker!.record("blur");
    });
    window.addEventListener("focus", () => {
      Tracker.isBlur = false;
      Tracker.tracker!.record("focus");
    });
    return Tracker.tracker || (Tracker.tracker = new Tracker());
  }

  readonly ws: WebSocket;

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

    let hbItv: NodeJS.Timeout;

    ws.addEventListener("message", async (ev) => {
      // parse command pack from server
      const { cmd, ...data } = unpackData(
        new Uint8Array(await (ev.data as Blob).arrayBuffer())
      ) as { cmd: string; [key: string]: any };
      // execute command
      switch (cmd) {
        case "uid": {
          this.uid = data.uid;
          clearInterval(hbItv);
          hbItv = setInterval(() => {
            if (ws.readyState !== ws.OPEN) return clearInterval(hbItv);
            if (Tracker.currentHref !== location.href) this.recordView();
            else ws.send(new Uint8Array([0]));
          }, 1000);
          break;
        }
        case "view": {
          this.recordView();
          break;
        }
      }
    });

    ws.addEventListener("error", (ev) => {
      console.error(ev);
      ws.close();
    });

    ws.addEventListener("close", () => {
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
    const href = location.href;
    Tracker.currentHref = href;
    Tracker.tracker!.record("view", { href });
  }
}

Tracker.init();
