import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, institutionsTable, usersTable, withInstitutionDb } from "@workspace/db";

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
    await expect(withInstitutionDb(second, (tx) => tx.select().from(usersTable)))
      .rejects.toThrow("Institution is unavailable");
  });
});
