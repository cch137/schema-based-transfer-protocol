import net from "net";
import { logMessage } from "./utils.js";

const PROTOCOL_DELIMITER = '|';

const client = net.createConnection({ port: 3000, host: 'localhost' }, () => {
  logMessage('connected to server!');

  const dataToSend = 'Hello, server!';
  const message = `CUSTOM_PROTOCOL${PROTOCOL_DELIMITER}${dataToSend}`;

  client.write(message);
  client.end();
});

client.on('data', (data) => {
  logMessage('received:', data.toString());
});

client.on('end', () => {
  logMessage('disconnected');
});
