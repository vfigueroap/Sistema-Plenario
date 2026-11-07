import { createServer } from "node:http";

const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/^\/[a-z0-9_]+_test$/.test(url.pathname) ||
  url.search
)
  throw new Error("Solo base local _test");
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = "production";
process.env.INSTITUTION_ID = "00000000-0000-4000-8000-000000000001";
process.env.SESSION_SECRET = "capacity-local-session-secret";
process.env.APP_URL = "https://capacity.example";
process.env.LOG_LEVEL = "error";
process.env.DB_POOL_MAX = "5";
process.env.SESSION_POOL_MAX = "3";
const moduleFile = new URL(
  process.env.CAPACITY_BUILD === "baseline"
    ? "../../artifacts/api-server/tmp/baseline/serverless.mjs"
    : "../../artifacts/api-server/dist/serverless.mjs",
  import.meta.url,
);
const { default: app } = await import(moduleFile.href);
const server = createServer(app);
server.keepAliveTimeout = 60000;
const port = Number(process.env.CAPACITY_PORT ?? 5188);
server.listen({ port, host: "127.0.0.1", backlog: 4096 }, () =>
  console.log(`API local ${port}`),
);
