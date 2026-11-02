"use strict";

const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { createApp } = require("./src/app");
const { rooms } = require("./src/meetings/meetingStore");
const { attachSignaling } = require("./src/websocket/signaling");

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;
let signaling;
const app = createApp({
  getOnlineUsers: () => signaling ? signaling.wss.clients.size : 0,
});
const server = http.createServer(app);
signaling = attachSignaling(server, rooms);

const selfUrl = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
if (selfUrl) {
  setInterval(() => {
    fetch(`${selfUrl.replace(/\/$/, "")}/api/status`).catch(() => {});
  }, 10 * 60 * 1000).unref();
}

server.listen(PORT, () => {
  console.log(`Duo server listening on http://localhost:${server.address().port}`);
});

function shutdown() {
  clearInterval(signaling.heartbeat);
  for (const socket of signaling.wss.clients) {
    socket.close(1001, "Server restarting");
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { server };
