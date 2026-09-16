import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The attendance router signals listeners via the realtime layer. Mock it so
// these tests exercise the justified-absence rules without Socket.io.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  emitUserEvent: vi.fn(),
  evictUserFromSession: vi.fn(async () => {}),
  SOCKET_PATH: "/api/socket.io",
}));

const { db, usersTable, plenariasTable, attendanceTable, justifiedAbsencesTable } =
  await import("@workspace/db");
const { eq, and } = await import("drizzle-orm");
const attendanceRouter = (await import("../routes/attendance")).default;

type FakeSession = {
  userId?: number;
  rol?: string;
  save: (cb: (err?: unknown) => void) => void;
  destroy: (cb: (err?: unknown) => void) => void;
};

function fakeSession(data: { userId?: number; rol?: string } = {}): FakeSession {
  return { ...data, save: (cb) => cb(), destroy: (cb) => cb() };
}

function makeApp(router: express.Router, session: FakeSession): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = session;
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", router);
  return app;
}

const uniq = `just-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const CODE = `JUST-${uniq}`;

let adminId: number;
let memberId: number;
let sessionId: number;

const adminApp = () => makeApp(attendanceRouter, fakeSession({ userId: adminId, rol: "admin" }));
const memberApp = () =>
  makeApp(attendanceRouter, fakeSession({ userId: memberId, rol: "miembro" }));

async function justifiedRow(): Promise<boolean> {
  const rows = await db
    .select()
    .from(justifiedAbsencesTable)
    .where(
      and(
        eq(justifiedAbsencesTable.sessionId, sessionId),
        eq(justifiedAbsencesTable.userId, memberId),
      ),
    );
  return rows.length > 0;
}

beforeAll(async () => {
  const hash = await bcrypt.hash("test-1234", 10);
  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `admin-${uniq}`,
      displayName: "Admin Justified",
      password: hash,
      rol: "admin",
      votingWeight: "0",
    })
    .returning();
  adminId = admin.id;

  const [member] = await db
    .insert(usersTable)
    .values({
      username: `member-${uniq}`,
      displayName: "Member Justified",
      password: hash,
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberId = member.id;

  const [session] = await db
    .insert(plenariasTable)
    .values({ title: "Justified plenaria (vitest)", sessionCode: CODE, status: "abierta" })
    .returning();
  sessionId = session.id;
});

afterAll(async () => {
  // Session delete cascades attendance + justified_absences rows.
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
  await db.delete(usersTable).where(eq(usersTable.id, memberId));
});

describe("Inasistencia Justificada", () => {
  it("rejects the justified flag from a non-admin with 403", async () => {
    const res = await request(memberApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false, justified: true });
    expect(res.status).toBe(403);
    expect(await justifiedRow()).toBe(false);
  });

  it("admin marks a justified absence: label stored, member stays absent", async () => {
    const res = await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false, justified: true });
    expect(res.status).toBe(200);
    expect(await justifiedRow()).toBe(true);

    // Operationally a normal absence: no attendance row exists.
    const att = await db
      .select()
      .from(attendanceTable)
      .where(
        and(eq(attendanceTable.sessionId, sessionId), eq(attendanceTable.userId, memberId)),
      );
    expect(att.length).toBe(0);

    // The attendance list surfaces the label via justifiedIds, in `absent`.
    const list = await request(adminApp()).get(`/api/sessions/${sessionId}/attendance`);
    expect(list.status).toBe(200);
    expect(list.body.justifiedIds).toContain(memberId);
    expect(list.body.absent.map((m: { id: number }) => m.id)).toContain(memberId);
    expect(list.body.present.length).toBe(0);
  });

  it("is idempotent: re-marking justified keeps a single row", async () => {
    const res = await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false, justified: true });
    expect(res.status).toBe(200);
    expect(await justifiedRow()).toBe(true);
  });

  it("self-attendance clears a stale justified label", async () => {
    const res = await request(memberApp())
      .post(`/api/sessions/${sessionId}/attendance`)
      .send({ sessionCode: CODE, modality: "online" });
    expect(res.status).toBe(200);
    expect(await justifiedRow()).toBe(false);
  });

  it("plain absent (justified:false) removes the label", async () => {
    // Re-justify first, then unmark.
    await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false, justified: true });
    expect(await justifiedRow()).toBe(true);

    const res = await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false });
    expect(res.status).toBe(200);
    expect(await justifiedRow()).toBe(false);
  });

  it("admin mark-present clears the justified label", async () => {
    await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: false, justified: true });
    expect(await justifiedRow()).toBe(true);

    const res = await request(adminApp())
      .patch(`/api/sessions/${sessionId}/attendance/${memberId}`)
      .send({ present: true, modality: "presencial" });
    expect(res.status).toBe(200);
    expect(await justifiedRow()).toBe(false);

    // And the list reports them present with no justified id.
    const list = await request(adminApp()).get(`/api/sessions/${sessionId}/attendance`);
    expect(list.body.justifiedIds).not.toContain(memberId);
    expect(list.body.present.map((m: { userId: number }) => m.userId)).toContain(memberId);
  });
});
