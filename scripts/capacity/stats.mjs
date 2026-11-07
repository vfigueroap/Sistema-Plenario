import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = require("pg");
const url = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/^\/[a-z0-9_]+_test$/.test(url.pathname)
)
  throw new Error("Solo base local _test");
const client = new Client({ connectionString: url.href });
await client.connect();
const result = await client.query(
  "select state,count(*)::int connections,round(max(extract(epoch from now()-xact_start)))::int longest_transaction_seconds from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() group by state",
);
console.log(JSON.stringify(result.rows));
await client.end();
