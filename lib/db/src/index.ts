import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import * as schema from "./schema";

const { Pool } = pg;

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const connectionString = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

// Integration tests write and delete fixtures. Never fall back to the app DB.
if (isTest) {
  let testUrl: URL;
  try {
    testUrl = new URL(connectionString ?? "");
  } catch {
    throw new Error("TEST_DATABASE_URL must point to a dedicated local PostgreSQL database ending in _test");
  }
  if (
    !["postgres:", "postgresql:"].includes(testUrl.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(testUrl.hostname) ||
    !/^\/[a-zA-Z0-9_]+_test$/.test(testUrl.pathname) ||
    testUrl.search || testUrl.hash
  ) {
    throw new Error("TEST_DATABASE_URL must use local PostgreSQL, a database ending in _test, and no query parameters");
  }
}

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const configuredPoolMax = Number(process.env.DB_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 5 : 20));
if (!Number.isInteger(configuredPoolMax) || configuredPoolMax < 1) {
  throw new Error("DB_POOL_MAX must be a positive integer");
}

// Keep each serverless instance small; Supabase's transaction pooler absorbs
// aggregate concurrency across Vercel instances. Local development can use a
// larger pool for the integration suite.
export const pool = new Pool({
  connectionString,
  max: configuredPoolMax,
  idleTimeoutMillis: 30000,
  keepAlive: true,
});
const baseDb = drizzle(pool, { schema });

export type InstitutionTransaction = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];
const institutionDb = new AsyncLocalStorage<InstitutionTransaction>();

export const db = new Proxy(baseDb, {
  get(target, property, receiver) {
    const active = institutionDb.getStore();
    return Reflect.get(active ?? target, property, active ?? receiver);
  },
}) as typeof baseDb;

/** The caller must authorize this institution before opening its DB scope.
 * All helpers in the callback must use tx, not the legacy db/pool exports.
 * Emissions and external I/O belong AFTER this promise commits successfully.
 */
export async function withInstitutionDb<T>(
  institutionId: string,
  work: (tx: InstitutionTransaction) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
    throw new Error("A valid institutionId is required");
  }
  return baseDb.transaction(async (tx) => {
    // The login needs membership in this NOLOGIN/NOBYPASSRLS role. The
    // migration owner is a separate credential; never use it in the server.
    await tx.execute(sql`set local role plenario_runtime`);
    await tx.execute(sql`select set_config('app.institution_id', ${institutionId}, true)`);
    const result = await tx.execute(sql`select id from institutions where id = ${institutionId}::uuid and active`);
    if (result.rows.length !== 1) throw new Error("Institution is unavailable");
    return institutionDb.run(tx, () => work(tx));
  });
}

export * from "./schema";
