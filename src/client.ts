(() => {
  const unpackData = (array: Uint8Array) =>
    JSON.parse(new TextDecoder().decode(array.reverse().map((v) => ~v & 0xff)));

  const packData = <T = any>(data: T) => {
    return new TextEncoder()
      .encode(JSON.stringify(data))
      .map((v) => ~v & 0xff)
      .reverse();
  };

  const record = (type: string, data: Record<string, any> = {}) => {
    if (ws.readyState !== ws.OPEN) {
      const sending = () => {
        record(type, data);
        ws.removeEventListener("open", sending);
      };
      ws[addEventListener]("open", sending);
      return;
    }
    ws.send(packData({ ...data, type }));
  };

  const recordView = () => {
    const href = location.href;
    currHref = href;
    record("view", { href });
  };

  const addEventListener = "addEventListener";
  const UID_KEY = "t";
  const getUid = () => localStorage.getItem(UID_KEY) || "";
  const setUid = (v: string) => localStorage.setItem(UID_KEY, v);

  let currHref = "";
  let ws: WebSocket;

  const createTracker = () => {
    ws = new WebSocket(`wss://space.cch137.link/${getUid()}`);
    // const ws = new WebSocket(`ws://localhost:4000/${this.uid}`);

    let hbItv: NodeJS.Timeout;

    ws[addEventListener]("message", async (ev) => {
      // parse command pack from server
      const { cmd, ...data } = unpackData(
        new Uint8Array(await (ev.data as Blob).arrayBuffer())
      ) as { cmd: string; [key: string]: any };
      // execute command
      switch (cmd) {
        case "uid": {
          setUid(data.uid);
          clearInterval(hbItv);
          hbItv = setInterval(() => {
            if (ws.readyState !== ws.OPEN) return clearInterval(hbItv);
            if (currHref !== location.href) recordView();
            else ws.send(new Uint8Array([0]));
          }, 1000);
          break;
        }
        case "view": {
          recordView();
          break;
        }
      }
    });

    ws[addEventListener]("error", (ev) => {
      console.error(ev);
      ws.close();
    });

    ws[addEventListener]("close", () => {
      const itv = setInterval(() => {
        if (document.hasFocus()) return;
        clearInterval(itv);
        createTracker();
      }, 1000);
    });
  };

  window[addEventListener]("blur", () => record("blur"));
  window[addEventListener]("focus", () => record("focus"));

  createTracker();
})();
