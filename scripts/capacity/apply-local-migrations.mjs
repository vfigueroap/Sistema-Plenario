import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = require("pg");
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/[a-z0-9_]+_test$/.test(url.pathname) || url.search)
  throw new Error("Solo base local _test");
const client = new Client({ connectionString: url.href });
await client.connect();
try {
  await client.query(await fs.readFile(new URL("../../lib/db/migrations/fresh/0006_enqueue_speaking.sql", import.meta.url), "utf8"));
  console.log("Migración de palabras aplicada en base local de prueba");
} finally {
  await client.end();
}
