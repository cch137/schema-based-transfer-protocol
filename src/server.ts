import net from "./net.js";
import { logMessage } from "./utils.js";

const server = net.createServer((socket) => {
  logMessage("client connected");

  socket.on("upgrade", () => {
    logMessage("client is upgrading...");
  });

  let i = 0;
  socket.on("message", (data) => {
    logMessage("client sent:", data);
    socket.send(`repeat: ${data}`);
    // if (++i > 5) socket.end();
  });

  socket.on("end", () => {
    logMessage("client disconnected");
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
