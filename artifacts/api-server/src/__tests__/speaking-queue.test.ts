import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, institutionsTable, plenariasTable, agendaPointsTable, usersTable, withInstitutionDb } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const institution = crypto.randomUUID();
const otherInstitution = crypto.randomUUID();
let sessionId: number;
let pointId: number;
let userId: number;
const enqueue = (user: number | null = null, tenant = institution) =>
  withInstitutionDb(tenant, (tx) => tx.execute(sql`
    select * from enqueue_individual_speaking_turn(${sessionId}, ${pointId}, 'pleno', ${user}::integer, 'Prueba ficticia', 60)
  `));

beforeAll(async () => {
  await db.insert(institutionsTable).values([
    { id: institution, slug: institution, name: "Prueba de cola" },
    { id: otherInstitution, slug: otherInstitution, name: "Otra institución" },
  ]);
  const [session] = await db.insert(plenariasTable).values({ institutionId: institution, title: "Prueba", sessionCode: institution, status: "abierta" }).returning();
  sessionId = session.id;
  pointId = (await db.insert(agendaPointsTable).values({ institutionId: institution, sessionId, title: "Punto", position: 0 }).returning())[0].id;
  userId = (await db.insert(usersTable).values({ institutionId: institution, username: institution, displayName: "Integrante ficticio", password: "hash ficticio" }).returning())[0].id;
});

afterAll(async () => {
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(institutionsTable).where(sql`${institutionsTable.id} in (${institution}, ${otherInstitution})`);
});

describe("cola de palabras sin viajes de red dentro del bloqueo", () => {
  it("asigna posiciones únicas y consecutivas a solicitudes simultáneas", async () => {
    const rows = await Promise.all(Array.from({ length: 30 }, () => enqueue()));
    expect(rows.every((result) => result.rows.length === 1)).toBe(true);
    const positions = rows.map((result) => Number(result.rows[0].position)).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("no duplica a un mismo integrante cuando espera el bloqueo", async () => {
    const rows = await Promise.all(Array.from({ length: 20 }, () => enqueue(userId)));
    expect(rows.flatMap((result) => result.rows)).toHaveLength(1);
  });

  it("mantiene el aislamiento por institución", async () => {
    await expect(enqueue(userId, otherInstitution)).rejects.toThrow();
  });
});
