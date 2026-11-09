import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, institutionsTable, usersTable, withInstitutionDb, resetInstitutionActiveCache } from "@workspace/db";
import { sharedValue } from "../lib/shared-cache";

const first = crypto.randomUUID();
const second = crypto.randomUUID();

beforeAll(async () => {
  await db.insert(institutionsTable).values([
    { id: first, slug: `first-${first}`, name: "First" },
    { id: second, slug: `second-${second}`, name: "Second" },
  ]);
  await db.insert(usersTable).values([
    { institutionId: first, username: `same-${first}`, displayName: "First user", password: "hash" },
    { institutionId: second, username: `same-${second}`, displayName: "Second user", password: "hash" },
  ]);
});

afterAll(async () => {
  await db.delete(usersTable).where(sql`${usersTable.institutionId} in (${first}, ${second})`);
  await db.delete(institutionsTable).where(sql`${institutionsTable.id} in (${first}, ${second})`);
});

describe("institution RLS context", () => {
  it("limita consultas y bloqueos dentro de la transacción y libera la conexión después de un timeout", async () => {
    const settings = await withInstitutionDb(first, (tx) => tx.execute(sql`select current_setting('statement_timeout') as statement, current_setting('lock_timeout') as lock, current_setting('idle_in_transaction_session_timeout') as idle`));
    expect(settings.rows[0]).toEqual({ statement: "12s", lock: "8s", idle: "15s" });
    await expect(withInstitutionDb(first, async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '100', true)`);
      await tx.execute(sql`select pg_sleep(0.3)`);
    })).rejects.toThrow();
    const rows = await withInstitutionDb(first, (tx) => tx.select().from(usersTable));
    expect(rows).toHaveLength(1);
  });
  it("separa lecturas simultáneas de la caché entre instituciones",async () => {
    const read=(id:string) => withInstitutionDb(id,async () => sharedValue("same-key",async () => {
      await new Promise((resolve) => setTimeout(resolve,20));
      return db.select().from(usersTable);
    }));
    const [a,b]=await Promise.all([read(first),read(second)]);
    expect(a.every((row) => row.institutionId===first)).toBe(true);
    expect(b.every((row) => row.institutionId===second)).toBe(true);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
  it("returns only rows from the selected institution", async () => {
    const rows = await withInstitutionDb(first, (tx) => tx.select().from(usersTable));
    expect(rows.map((row) => row.institutionId)).toEqual([first]);
  });

  it("does not inherit one institution into the next request", async () => {
    await withInstitutionDb(first, (tx) => tx.select().from(usersTable));
    const rows = await withInstitutionDb(second, (tx) => tx.select().from(usersTable));
    expect(rows.map((row) => row.institutionId)).toEqual([second]);
  });

  it("rejects an inactive institution", async () => {
    await db.update(institutionsTable).set({ active: false }).where(eq(institutionsTable.id, second));
    resetInstitutionActiveCache();
    await expect(withInstitutionDb(second, (tx) => tx.select().from(usersTable)))
      .rejects.toThrow("Institution is unavailable");
  });
});
