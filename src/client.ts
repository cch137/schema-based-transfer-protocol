(() => {
  const unpackData = (array: Uint8Array) =>
    JSON.parse(new TextDecoder().decode(array.reverse().map((v) => ~v & 0xff)));

  const packData = <T = any>(data: T) => {
    return new TextEncoder()
      .encode(JSON.stringify(data))
      .map((v) => ~v & 0xff)
      .reverse();
  };

  const ttxBroadcast = (type: string) =>
    window.dispatchEvent(new Event(`TTX-${type}`));

  const record = (type: string, data: Record<string, any> = {}) => {
    if (ws.readyState !== ws.OPEN) {
      const sending = () => {
        record(type, data);
        ws.removeEventListener("open", sending);
      };
      ws[addEventListener]("open", sending);
      return;
    }
    ttxBroadcast(type);
    ws.send(packData({ ...data, type }));
  };

  const recordView = () => {
    const href = location.href;
    currHref = href;
    record("view", { href, focus: isFocus() });
  };

  const addEventListener = "addEventListener";
  const V_TAG = "3";
  const STORAGE_KEY = "t";
  const HEARTBEAT_MS = 1000;
  const RECONNECT_MS = 1000;

  const getUid = () => localStorage.getItem(STORAGE_KEY) || "";
  const setUid = (s: string) => localStorage.setItem(STORAGE_KEY, s);
  const isFocus = () => document.hasFocus();

  let currHref = "";
  let ws: WebSocket;

  const createTracker = (force = false) => {
    if (!force && !isFocus()) {
      setTimeout(createTracker, RECONNECT_MS);
      return;
    }

    // ws = new WebSocket(`wss://space.cch137.link/${V_TAG}/${getUid()}`);
    ws = new WebSocket(`ws://localhost:4000/${V_TAG}/${getUid()}`);

    ws[addEventListener]("open", () => {
      const hbItv: NodeJS.Timeout = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return clearInterval(hbItv);
        if (currHref !== location.href) recordView();
        else ws.send(new Uint8Array([0]));
      }, HEARTBEAT_MS);
    });

    ws[addEventListener]("message", async (ev) => {
      // parse command pack from server
      const { cmd, ...data } = unpackData(
        new Uint8Array(await (ev.data as Blob).arrayBuffer())
      ) as { cmd: string; [key: string]: any };
      console.log(cmd, data);
      if (typeof cmd !== "string") return;
      ttxBroadcast(cmd);
      // execute command
      switch (cmd) {
        case "uid": {
          setUid(data.uid);
          break;
        }
        case "conn": {
          recordView();
          break;
        }
        case "v-err": {
          location.reload();
          break;
        }
      }
    });

    ws[addEventListener]("error", (ev) => {
      console.error(ev);
      ws.close();
    });

    ws[addEventListener]("close", () => {
      setTimeout(createTracker, RECONNECT_MS);
    });
  };

  window[addEventListener]("blur", () => record("blur"));
  window[addEventListener]("focus", () => record("focus"));
  window[addEventListener]("TTX-record", ({ data: { type, data } }: any) =>
    record(type, data)
  );

  createTracker(true);
})();
