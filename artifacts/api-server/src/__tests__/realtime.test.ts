import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  initRealtime,
  emitSessionEvent,
  emitLobbyEvent,
  evictUserFromSession,
  __resetEmitThrottleForTests,
  SOCKET_PATH,
} from "../lib/realtime";
import { db, plenariasTable, usersTable, attendanceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Server as SocketIoServer } from "socket.io";

// A stand-in for the real express-session middleware. It derives the
// authenticated userId from a `uid` query param and the role from an optional
// `rol` query param on the handshake URL, mirroring how the real middleware
// attaches `req.session.userId` / `req.session.rol` from the cookie. A socket
// with no `uid` is treated as anonymous.
const fakeSessionMiddleware: RequestHandler = (req, _res, next) => {
  const url = (req as { url?: string }).url ?? "";
  const uidMatch = url.match(/[?&]uid=(\d+)/);
  const rolMatch = url.match(/[?&]rol=(\w+)/);
  (req as { session?: { userId?: number; rol?: string } }).session = uidMatch
    ? { userId: Number(uidMatch[1]), rol: rolMatch ? rolMatch[1] : "miembro" }
    : {};
  next();
};

let httpServer: HttpServer;
let io: SocketIoServer;
let port: number;
let sessionId: number;
// A member who is actively attending the session (attendance row, not checked out).
let activeMemberId: number;
// A member who attended but later checked out (inactive attendance).
let retiredMemberId: number;
const clients: ClientSocket[] = [];

function connect(query?: Record<string, string>): ClientSocket {
  const socket = ioClient(`http://localhost:${port}`, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    extraHeaders: { Origin: `http://localhost:${port}` },
    reconnection: false,
    query,
  });
  clients.push(socket);
  return socket;
}

// Connect and wait for the socket to be fully connected before resolving.
async function connectAndWait(query?: Record<string, string>): Promise<ClientSocket> {
  const socket = connect(query);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("did not connect")), 4000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (e) =>
      reject(new Error(`unexpected connect_error: ${(e as Error).message}`)),
    );
  });
  return socket;
}

beforeAll(async () => {
  httpServer = createServer();
  io = initRealtime(httpServer, fakeSessionMiddleware);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      resolve();
    });
  });

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  // The `join` handler authorizes by role and active attendance, so tests need a
  // real plenaria plus real member/attendance rows.
  const [session] = await db
    .insert(plenariasTable)
    .values({
      title: "Realtime test plenaria (vitest)",
      sessionCode: `RT-${unique}`,
      status: "abierta",
    })
    .returning();
  sessionId = session.id;

  const [activeMember] = await db
    .insert(usersTable)
    .values({
      username: `rt-active-${unique}`,
      displayName: "Realtime Active Member",
      password: "x",
      rol: "miembro",
    })
    .returning();
  activeMemberId = activeMember.id;

  const [retiredMember] = await db
    .insert(usersTable)
    .values({
      username: `rt-retired-${unique}`,
      displayName: "Realtime Retired Member",
      password: "x",
      rol: "miembro",
    })
    .returning();
  retiredMemberId = retiredMember.id;

  // Active attendance (not checked out) for the active member.
  await db.insert(attendanceTable).values({ sessionId, userId: activeMemberId });
  // Checked-out attendance for the retired member.
  await db
    .insert(attendanceTable)
    .values({ sessionId, userId: retiredMemberId, checkedOutAt: new Date() });
});

// Throttle state is a per-process singleton shared by every test in this file;
// reset it before each test so a pending trailing emit from one test can't fire
// during the next and skew its assertions.
beforeEach(() => {
  __resetEmitThrottleForTests();
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  // Deleting the plenaria cascades its attendance rows; then remove the test users.
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  await db.delete(usersTable).where(eq(usersTable.id, activeMemberId));
  await db.delete(usersTable).where(eq(usersTable.id, retiredMemberId));
});

describe("realtime socket auth gate", () => {
  it("rejects an unauthenticated connection", async () => {
    const socket = connect();
    const err = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no connect_error fired")), 4000);
      socket.on("connect_error", (e) => {
        clearTimeout(timer);
        resolve(e as Error);
      });
      socket.on("connect", () => {
        clearTimeout(timer);
        reject(new Error("unauthenticated socket should not connect"));
      });
    });
    expect(err.message).toBe("No autenticado");
    expect(socket.connected).toBe(false);
  });

  it("accepts an authenticated connection", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });
    expect(socket.connected).toBe(true);
  });
});

describe("realtime session room join authorization", () => {
  it("delivers session events to an active attendee after they join the room", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    const received = new Promise<{ sessionId: number }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("did not receive speaking:changed in room")),
        4000,
      );
      socket.on("speaking:changed", (payload: { sessionId: number }) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    // Join the room, then broadcast. A short delay lets the server process the
    // join (which queries attendance) before the emit.
    socket.emit("join", sessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(sessionId, "speaking:changed");

    const payload = await received;
    expect(payload.sessionId).toBe(sessionId);
  });

  it("lets an admin join any session even without attendance", async () => {
    // uid 1 has no attendance row for this session, but rol=admin grants access.
    const socket = await connectAndWait({ uid: "1", rol: "admin" });

    const received = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("admin did not receive event in room")),
        4000,
      );
      socket.on("speaking:changed", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    socket.emit("join", sessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(sessionId, "speaking:changed");
    await received;
  });

  it("denies a member with no attendance record", async () => {
    // A logged-in member who never marked attendance for this session.
    const socket = await connectAndWait({ uid: "987654321" });

    let delivered = false;
    socket.on("speaking:changed", () => {
      delivered = true;
    });

    socket.emit("join", sessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(sessionId, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toBe(false);
  });

  it("denies a member whose attendance has been checked out", async () => {
    const socket = await connectAndWait({ uid: String(retiredMemberId) });

    let delivered = false;
    socket.on("speaking:changed", () => {
      delivered = true;
    });

    socket.emit("join", sessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(sessionId, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toBe(false);
  });

  it("ignores a join for a session that does not exist", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    let delivered = false;
    socket.on("speaking:changed", () => {
      delivered = true;
    });

    const ghostSessionId = 987654321;
    socket.emit("join", ghostSessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(ghostSessionId, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toBe(false);
  });

  // The join handler rejects non-positive / non-integer ids before it ever
  // touches the database (`!Number.isInteger(id) || id <= 0`). These inputs must
  // never result in any room membership, so even a broadcast to the matching
  // session room must not reach the socket (it never joined).
  it.each([
    ["zero", 0],
    ["a negative number", -5],
    ["a non-numeric string", "abc"],
    ["a fractional number", 1.5],
  ])("ignores a join with an invalid session id (%s)", async (_label, badId) => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    let delivered = false;
    socket.on("speaking:changed", () => {
      delivered = true;
    });

    socket.emit("join", badId);
    await new Promise((r) => setTimeout(r, 200));
    // Broadcast to the real, authorized session room. If the bogus join had
    // somehow subscribed the socket, this is where it would leak through.
    emitSessionEvent(sessionId, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toBe(false);
  });
});

describe("realtime session room eviction", () => {
  it("stops delivering events after a member is evicted", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    // First confirm the active attendee is receiving events in the room.
    const firstHit = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("did not receive first event")), 4000);
      socket.once("speaking:changed", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    socket.emit("join", sessionId);
    await new Promise((r) => setTimeout(r, 200));
    emitSessionEvent(sessionId, "speaking:changed");
    await firstHit;

    // Evict the member server-side (as a checkout / mark-absent would), then
    // broadcast again — the socket must no longer receive events.
    await evictUserFromSession(sessionId, activeMemberId);
    let deliveredAfterEvict = false;
    socket.on("speaking:changed", () => {
      deliveredAfterEvict = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    emitSessionEvent(sessionId, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(deliveredAfterEvict).toBe(false);
  });
});

describe("realtime room scoping", () => {
  it("does not deliver events for a room the socket has not joined", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    let delivered = false;
    socket.on("speaking:changed", () => {
      delivered = true;
    });

    // Broadcast to an unrelated room the socket never joined.
    emitSessionEvent(999999, "speaking:changed");
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toBe(false);
  });
});

describe("realtime lobby room", () => {
  it("delivers lobby events to any authenticated socket without joining a session", async () => {
    const socket = await connectAndWait({ uid: String(activeMemberId) });

    const received = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("did not receive sessions:changed in lobby")),
        4000,
      );
      socket.on("sessions:changed", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // No `join` call — every authenticated socket is auto-joined to the lobby.
    await new Promise((r) => setTimeout(r, 150));
    emitLobbyEvent("sessions:changed");

    await received;
  });
});
