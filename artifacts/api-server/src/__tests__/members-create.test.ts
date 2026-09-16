import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The members router doesn't touch realtime, but other imported modules might;
// stub the layer for consistency with the sibling route tests.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  emitUserEvent: vi.fn(),
  evictUserFromSession: vi.fn(async () => {}),
  disconnectUser: vi.fn(async () => {}),
  SOCKET_PATH: "/api/socket.io",
}));

const { db, usersTable } = await import("@workspace/db");
const { eq, or } = await import("drizzle-orm");
const membersRouter = (await import("../routes/members")).default;

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

const PASSWORD = "test-1234";
const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const existingUsername = `existing-${uniq}`;
const newUsername = `new-member-${uniq}`;

let adminId: number;
let existingMemberId: number;

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const [admin] = await db
    .insert(usersTable)
    .values({ username: `admin-${uniq}`, displayName: "Admin Test", password: hash, rol: "admin", votingWeight: "0" })
    .returning();
  adminId = admin.id;

  const [existing] = await db
    .insert(usersTable)
    .values({ username: existingUsername, displayName: "Existing", password: hash, rol: "miembro", votingWeight: "1" })
    .returning();
  existingMemberId = existing.id;
});

afterAll(async () => {
  await db
    .delete(usersTable)
    .where(or(eq(usersTable.id, adminId), eq(usersTable.id, existingMemberId), eq(usersTable.username, newUsername)));
});

describe("POST /members (create member)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(makeApp(membersRouter, fakeSession()))
      .post("/api/members")
      .send({ username: newUsername, displayName: "New", password: "1234" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin member with 403", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: existingMemberId, rol: "miembro" }));
    const res = await request(app)
      .post("/api/members")
      .send({ username: newUsername, displayName: "New", password: "1234" });
    expect(res.status).toBe(403);
  });

  it("rejects missing required fields with 400", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app).post("/api/members").send({ username: newUsername });
    expect(res.status).toBe(400);
  });

  it("lets an admin create a member and persists it", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .post("/api/members")
      .send({ username: newUsername, displayName: "New Member", password: "1234", group: "CEE", faculty: "FAU", votingWeight: 1.5 });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe(newUsername);
    expect(res.body.votingWeight).toBe(1.5);
    expect(res.body.rol).toBe("miembro");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.username, newUsername));
    expect(row).toBeDefined();
    // Password is hashed, and the plaintext is stored for admin visibility.
    expect(row.password).not.toBe("1234");
    expect(await bcrypt.compare("1234", row.password)).toBe(true);
    expect(row).not.toHaveProperty("plainPassword");
  });

  it("rejects a duplicate username case-insensitively with 409", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .post("/api/members")
      .send({ username: existingUsername.toUpperCase(), displayName: "Dup", password: "1234" });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /members/:id (delete member)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(makeApp(membersRouter, fakeSession())).delete(`/api/members/${existingMemberId}`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin member with 403", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: existingMemberId, rol: "miembro" }));
    const res = await request(app).delete(`/api/members/${existingMemberId}`);
    expect(res.status).toBe(403);
  });

  it("refuses to delete an admin account with 400", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app).delete(`/api/members/${adminId}`);
    // Self-delete guard triggers first (admin deleting itself), still a 400.
    expect(res.status).toBe(400);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, adminId));
    expect(row).toBeDefined();
  });

  it("returns 404 for a non-existent member", async () => {
    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app).delete("/api/members/987654321");
    expect(res.status).toBe(404);
  });

  it("lets an admin delete a member and removes the row", async () => {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [victim] = await db
      .insert(usersTable)
      .values({ username: `victim-${uniq}`, displayName: "Victim", password: hash, rol: "miembro", votingWeight: "1" })
      .returning();

    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app).delete(`/api/members/${victim.id}`);
    expect(res.status).toBe(204);

    const rows = await db.select().from(usersTable).where(eq(usersTable.id, victim.id));
    expect(rows).toHaveLength(0);
  });

  it("revokes the deleted member's active login sessions", async () => {
    const { sql } = await import("drizzle-orm");
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [victim] = await db
      .insert(usersTable)
      .values({ username: `victim-sess-${uniq}`, displayName: "Victim Sess", password: hash, rol: "miembro", votingWeight: "1" })
      .returning();

    // Simulate an active login session for this user in the connect-pg-simple store.
    const sid = `test-sess-${uniq}`;
    await db.execute(
      sql`INSERT INTO session (sid, sess, expire) VALUES (${sid}, ${JSON.stringify({ userId: victim.id, rol: "miembro" })}::json, NOW() + interval '1 day')`,
    );

    const app = makeApp(membersRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app).delete(`/api/members/${victim.id}`);
    expect(res.status).toBe(204);

    const remaining = await db.execute(sql`SELECT sid FROM session WHERE sid = ${sid}`);
    expect(remaining.rows).toHaveLength(0);
  });
});
