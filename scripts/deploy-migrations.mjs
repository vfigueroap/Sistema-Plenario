import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("./package.json", import.meta.url));
const { Client } = require("pg");
const localTest = process.argv.includes("--local-test");
if (!localTest && (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production")) {
  console.log("Migración automática omitida fuera del despliegue de producción");
  process.exit(0);
}
const connectionString = localTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
const target = new URL(connectionString ?? "");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
if (localTest && (!local || !/^\/[a-z0-9_]+_test$/.test(target.pathname) || target.search || target.hash)) {
  throw new Error("La verificación solo acepta una base local terminada en _test");
}
const transactionPooler = target.hostname.endsWith(".pooler.supabase.com") && target.port === "6543";
if (!localTest && !transactionPooler) {
  throw new Error("DATABASE_URL de producción debe usar el pooler de transacciones de Supabase en el puerto 6543");
}
const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  const source = fs.readFileSync(new URL("../lib/db/migrations/fresh/0006_enqueue_speaking.sql", import.meta.url), "utf8");
  if (!/^BEGIN;\s/.test(source) || !/COMMIT;\s*$/.test(source)) throw new Error("La migración debe ser transaccional");
  await client.query(source.replace("BEGIN;", "BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '15s';"));
  const result = await client.query("select p.prosecdef as definer, has_function_privilege('plenario_runtime', p.oid, 'EXECUTE') as executable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enqueue_individual_speaking_turn'");
  if (result.rows.length !== 1 || result.rows[0].definer || !result.rows[0].executable) throw new Error("La función de palabras no tiene la configuración esperada");
  console.log(JSON.stringify({ migration: "0006_enqueue_speaking", applied: true, securityInvoker: true, transactionPooler, localTest }));
} catch (error) {
  console.error("No se activa el despliegue porque falló la migración de palabras", { code: error.code ?? error.name });
  process.exitCode = 1;
} finally {
  await client.end();
}
