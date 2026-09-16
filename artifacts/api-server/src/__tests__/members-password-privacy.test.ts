import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub the database boundary completely: no pool, schema import or real data.
const { db, query } = vi.hoisted(() => {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(),
    returning: vi.fn(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  return { query, db: {
    select: vi.fn(() => query),
    insert: vi.fn(() => query),
    update: vi.fn(() => query),
  } };
});
vi.mock("@workspace/db", () => ({
  db,
  usersTable: { id: "id", username: "username", displayName: "display_name" },
  attendanceTable: {},
  plenariasTable: {},
}));
vi.mock("../lib/realtime", () => ({
  disconnectUser: vi.fn(), evictUserFromSession: vi.fn(),
  emitSessionEvent: vi.fn(), emitUserEvent: vi.fn(),
}));

import membersRouter from "../routes/members";

const legacy = {
  id: 7, username: "fixture", displayName: "Fixture", group: "CEE", faculty: "FAU",
  email: "fixture@example.test", password: bcrypt.hashSync("old-fixture", 10),
  plainPassword: "legacy-fixture", votingWeight: "1.5000", votingWeightAlt: "2.0000",
  active: true, rol: "miembro",
};

function app(rol = "admin") {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    Object.assign(req, { session: { userId: 7, rol } });
    next();
  });
  server.use(membersRouter);
  return server;
}

function expectPrivate(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toContain(legacy.plainPassword);
  expect(json).not.toContain(legacy.password);
  expect(json).not.toContain("plainPassword");
}

beforeEach(() => {
  vi.clearAllMocks();
  query.where.mockReset().mockReturnThis();
  query.orderBy.mockResolvedValue([{ ...legacy }]);
  query.returning.mockResolvedValue([{ ...legacy }]);
});

describe("members password privacy (database mocked, not integration)", () => {
  it.each(["admin", "miembro"])("lists password:null for %s, preserving email visibility and weights", async (rol) => {
    const res = await request(app(rol)).get("/members");
    expect(res.status).toBe(200);
    expectPrivate(res.body);
    expect(res.body[0]).toEqual({
      id: 7, username: "fixture", displayName: "Fixture", group: "CEE", faculty: "FAU",
      email: rol === "admin" ? legacy.email : null, password: null,
      votingWeight: 1.5, votingWeightAlt: 2, active: true, rol: "miembro",
    });
  });

  it("creates with bcrypt only and returns password:null even for a legacy row", async () => {
    query.where.mockResolvedValueOnce([]);
    const res = await request(app()).post("/members").send({
      username: "fixture", displayName: "Fixture", password: "new-fixture",
    });
    expect(res.status).toBe(201);
    const stored = query.values.mock.calls[0][0];
    expect(stored).not.toHaveProperty("plainPassword");
    expect(await bcrypt.compare("new-fixture", stored.password)).toBe(true);
    expect(bcrypt.getRounds(stored.password)).toBe(10);
    expectPrivate(res.body);
    expect(res.body.password).toBeNull();
  });

  it("sanitizes the admin update response without writing historical plaintext", async () => {
    query.where.mockResolvedValueOnce([{ ...legacy }]);
    const res = await request(app()).patch("/members/7").send({ votingWeight: 3 });
    expect(res.status).toBe(200);
    expect(query.set).toHaveBeenCalledWith({ votingWeight: "3" });
    expectPrivate(res.body);
    expect(res.body.password).toBeNull();
  });

  it("keeps the email response free of credentials", async () => {
    const res = await request(app("miembro")).patch("/members/me/email")
      .send({ email: "fixture@example.test" });
    expect(res.status).toBe(200);
    expectPrivate(res.body);
    expect(res.body).not.toHaveProperty("password");
  });

  it.each(["/members/me/password", "/members/7/password"])("%s writes only bcrypt and preserves the reset response", async (path) => {
    query.where.mockResolvedValueOnce([{ ...legacy }]);
    // The admin reset has no preceding lookup; its where must remain chainable.
    if (path === "/members/7/password") query.where.mockReset().mockReturnThis();
    const res = await request(app()).patch(path)
      .send({ currentPassword: "old-fixture", newPassword: "new-fixture" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const stored = query.set.mock.calls[0][0];
    expect(Object.keys(stored)).toEqual(["password"]);
    expect(await bcrypt.compare("new-fixture", stored.password)).toBe(true);
    expect(bcrypt.getRounds(stored.password)).toBe(10);
  });

  it("still rejects an incorrect current password without writing", async () => {
    query.where.mockResolvedValueOnce([{ ...legacy }]);
    const res = await request(app("miembro")).patch("/members/me/password")
      .send({ currentPassword: "incorrect-fixture", newPassword: "new-fixture" });
    expect(res.status).toBe(400);
    expect(query.set).not.toHaveBeenCalled();
    expectPrivate(res.body);
  });
});
