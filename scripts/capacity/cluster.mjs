import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  !/^\/[a-z0-9_]+_test$/.test(database.pathname)
)
  throw new Error("Solo base local _test");
const delay = Number(process.env.CAPACITY_DB_RTT_MS ?? 10) / 2;
const upstreamPort = Number(database.port);
const connections = new Set();
const proxy = net.createServer((incoming) => {
  const outgoing = net.connect(upstreamPort, database.hostname);
  incoming.setNoDelay(true);
  outgoing.setNoDelay(true);
  connections.add(incoming);
  const forward = (source, target) =>
    source.on("data", (chunk) => {
      source.pause();
      setTimeout(() => {
        if (!target.destroyed) target.write(chunk, () => source.resume());
      }, delay);
    });
  forward(incoming, outgoing);
  forward(outgoing, incoming);
  incoming.on("close", () => {
    outgoing.destroy();
    connections.delete(incoming);
  });
  outgoing.on("close", () => incoming.destroy());
  incoming.on("error", () => outgoing.destroy());
  outgoing.on("error", () => incoming.destroy());
});
await new Promise((resolve) => proxy.listen(55439, "127.0.0.1", resolve));
database.port = "55439";
const children = Array.from({ length: 4 }, (_, i) =>
  spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    {
      windowsHide: true,
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_DATABASE_URL: database.href,
        CAPACITY_PORT: String(5190 + i),
        CAPACITY_BUILD: "",
      },
    },
  ),
);
process.on("SIGINT", () => {
  children.forEach((child) => child.kill());
  connections.forEach((connection) => connection.destroy());
  proxy.close();
  process.exit();
});
