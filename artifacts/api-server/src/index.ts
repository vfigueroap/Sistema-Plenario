import { createServer } from "node:http";
import app, { sessionMiddleware } from "./app";
import { initRealtime } from "./lib/realtime";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? "3001";

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Share a single HTTP server between Express and Socket.io so websocket
// upgrades arrive on the same port the proxy already forwards to.
const httpServer = createServer(app);
initRealtime(httpServer, sessionMiddleware);

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
