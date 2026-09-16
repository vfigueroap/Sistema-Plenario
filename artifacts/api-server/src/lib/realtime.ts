import type { Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { Server as SocketIoServer, type Socket } from "socket.io";
import { and, eq, isNull } from "drizzle-orm";
import { db, plenariasTable, attendanceTable, withInstitutionDb } from "@workspace/db";
import { logger } from "./logger";
import { createAllowedOrigin } from "./allowed-origin";

// Custom path so the connection routes through the local reverse proxy, which
// dispatches by path prefix. The proxy forwards "/api" to this service, so the
// Socket.io endpoint must live under "/api". Paths are NOT rewritten, so the
// client must use the same path.
export const SOCKET_PATH = "/api/socket.io";

export type SessionEvent =
  | "attendance:changed"
  | "session:changed"
  | "speaking:changed"
  | "votes:changed";

// List-level events broadcast to every authenticated client (the lobby), used
// to keep session lists and "open session" lookups in sync the moment a session
// is created, opened, closed, or deleted.
export type LobbyEvent = "sessions:changed";

// Per-user events delivered to a single member across all of their tabs/devices
// via a room they join at connection time (`user:<id>`). Unlike session rooms,
// this channel is NOT gated on active attendance, so a member the admin just
// removed from a session (retired / marked absent / deactivated) still receives
// the signal to refresh — that's the whole point: an admin-driven access change
// must reach the affected member instantly even though they're no longer in the
// session room and would therefore miss that room's broadcast.
export type UserEvent = "access:changed";

// Every authenticated socket joins this room on connection, so list-level
// changes reach all connected users regardless of which session they're viewing.
const institutionId = process.env.INSTITUTION_ID ?? "00000000-0000-4000-8000-000000000001";
const LOBBY_ROOM = `institution:${institutionId}:lobby`;

let io: SocketIoServer | null = null;

function roomFor(sessionId: number): string {
  return `institution:${institutionId}:session:${sessionId}`;
}

function userRoomFor(userId: number): string {
  return `institution:${institutionId}:user:${userId}`;
}

// Coalescing/rate-limiting for fan-out emits. A single admin action — or a burst
// of ~200 near-simultaneous votes on one topic — can trigger many identical
// emits in a moment; without bounding them, every connected client would
// invalidate and refetch on each one (a thundering herd against the API + DB
// pool). We throttle per (room,event[,discriminator]) with a leading+trailing
// strategy: the first emit goes out immediately (keeps the "instant" feel) and,
// if more emits arrive during the window, exactly one more fires when the window
// closes (so the final state is never missed).
const EMIT_THROTTLE_MS = 1000;
type ThrottleEntry = {
  timer: ReturnType<typeof setTimeout>;
  trailing: boolean;
  room: string;
  event: string;
  payload: unknown;
};
const emitThrottle = new Map<string, ThrottleEntry>();

function throttledEmit(
  key: string,
  room: string,
  event: string,
  payload: unknown,
): void {
  if (!io) return;
  const existing = emitThrottle.get(key);
  if (existing) {
    // Inside the window: remember we owe a trailing emit with the latest payload.
    existing.trailing = true;
    existing.payload = payload;
    return;
  }
  // Leading edge: emit now and open the throttle window.
  io.to(room).emit(event, payload);
  const timer = setTimeout(() => {
    const entry = emitThrottle.get(key);
    emitThrottle.delete(key);
    if (entry?.trailing) {
      try {
        io?.to(entry.room).emit(entry.event, entry.payload);
      } catch {
        // The server may be closing/closed (e.g. during test teardown); ignore.
      }
    }
  }, EMIT_THROTTLE_MS);
  // Don't let a pending trailing emit keep the process alive on shutdown.
  if (typeof timer.unref === "function") timer.unref();
  emitThrottle.set(key, { timer, trailing: false, room, event, payload });
}

// Test-only: clear all pending throttle timers and state. The throttle map is a
// per-process singleton; in production that is correct (continuous emits), but a
// test process shares one module instance across many tests, so a pending
// trailing timer from one test can otherwise fire during a later one. Not used
// in production code.
export function __resetEmitThrottleForTests(): void {
  for (const entry of emitThrottle.values()) clearTimeout(entry.timer);
  emitThrottle.clear();
}

// Adapt an Express middleware so it can run inside Socket.io's connection
// handshake, giving each socket access to the parsed session (and thus the
// authenticated userId stored at login).
function wrapMiddleware(mw: RequestHandler) {
  return (socket: Socket, next: (err?: Error) => void) => {
    mw(socket.request as never, {} as never, next as never);
  };
}

export function initRealtime(
  httpServer: HttpServer,
  sessionMiddleware: RequestHandler,
): SocketIoServer {
  const allowedOrigin = createAllowedOrigin(process.env);
  io = new SocketIoServer(httpServer, {
    path: SOCKET_PATH,
    // Same-origin in the browser (served behind the proxy), but allow
    // credentials so the session cookie is sent on the handshake request.
    cors: {
      origin: (origin, callback) => callback(null, allowedOrigin(origin)),
      credentials: true,
    },
    allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin)),
  });

  // Parse the session cookie on every handshake.
  io.use(wrapMiddleware(sessionMiddleware));

  // Reject unauthenticated connections — only logged-in users may listen.
  io.use((socket, next) => {
    const session = (socket.request as { session?: { userId?: number; institutionId?: string } })
      .session;
    const sessionInstitution = session?.institutionId ??
      (process.env.NODE_ENV === "test" ? institutionId : "");
    if (!session?.userId || sessionInstitution !== institutionId) {
      next(new Error("No autenticado"));
      return;
    }
    next();
  });

  io.on("connection", (socket) => {
    // Mirror the authenticated identity onto socket.data so it survives the
    // RemoteSocket projection returned by fetchSockets() (used for eviction),
    // which does not expose the underlying request/session.
    const connSession = (
      socket.request as { session?: { userId?: number; rol?: string } }
    ).session;
    socket.data.userId = connSession?.userId;
    socket.data.rol = connSession?.rol;

    // Every authenticated client listens for list-level changes immediately.
    socket.join(LOBBY_ROOM);

    // Also join a private room keyed on the user id so we can push targeted
    // signals ("your access changed") that must reach the member even after
    // they've been evicted from a session room.
    if (typeof socket.data.userId === "number") {
      socket.join(userRoomFor(socket.data.userId));
    }

    socket.on("join", async (sessionId: unknown) => {
      const id = Number(sessionId);
      if (!Number.isInteger(id) || id <= 0) return;

      // Authorize the room join before subscribing. Live signals are a push
      // channel scoped to the people actually in a session, which is stricter
      // than the REST view rules on purpose: any authenticated user may *fetch*
      // a session over REST (members need that to discover and join sessions),
      // but live updates only flow to admins and active attendees.
      //   - Admins may observe any existing session's live room.
      //   - Members may only join a session they are actively attending, i.e.
      //     they have an attendance record that has not been checked out.
      // This stays the single chokepoint to tighten further if events ever start
      // carrying payloads or sessions need stricter access.
      const session = (
        socket.request as { session?: { userId?: number; rol?: string } }
      ).session;
      if (!session?.userId) return;

      try {
        const authorized = await withInstitutionDb(institutionId, async () => {
          const [plenaria] = await db.select({ id: plenariasTable.id })
            .from(plenariasTable).where(eq(plenariasTable.id, id)).limit(1);
          if (!plenaria) return false;

          if (session.rol !== "admin") {
            const [attendance] = await db.select({ id: attendanceTable.id })
              .from(attendanceTable)
              .where(and(eq(attendanceTable.sessionId, id), eq(attendanceTable.userId, session.userId!), isNull(attendanceTable.checkedOutAt)))
              .limit(1);
            if (!attendance) return false;
          }
          return true;
        });
        if (!authorized) return;
      } catch (err) {
        logger.error({ err, sessionId: id }, "Socket join authorization failed");
        return;
      }

      socket.join(roomFor(id));
    });

    socket.on("leave", (sessionId: unknown) => {
      const id = Number(sessionId);
      if (!Number.isInteger(id) || id <= 0) return;
      socket.leave(roomFor(id));
    });
  });

  logger.info({ path: SOCKET_PATH }, "Socket.io realtime initialized");
  return io;
}

// Broadcast a lightweight signal to everyone watching a session. Clients react
// by invalidating the matching React Query cache and refetching over REST, so
// the REST contract remains the single source of truth.
export function emitSessionEvent(sessionId: number, event: SessionEvent): void {
  const room = roomFor(sessionId);
  throttledEmit(`${room}|${event}`, room, event, { sessionId });
}

// Signal that a topic's tally changed (a vote was cast). Carries the topicId so
// clients can invalidate exactly that topic's results query. Throttled per topic
// so concurrent open topics never coalesce into a single signal.
export function emitVotesChanged(sessionId: number, topicId: number): void {
  const room = roomFor(sessionId);
  throttledEmit(`${room}|votes:changed|${topicId}`, room, "votes:changed", {
    sessionId,
    topicId,
  });
}

// Remove a member's sockets from a session's live room once they are no longer
// an active attendee. Join-time authorization alone is not enough: a member who
// is already in the room when their attendance is revoked (self check-out, or an
// admin marking them absent) must stop receiving live updates immediately, no
// matter which backend path changed the attendance. Admin sockets are never
// evicted — they may observe any session.
export async function evictUserFromSession(
  sessionId: number,
  userId: number,
): Promise<void> {
  if (!io) return;
  const room = roomFor(sessionId);
  const sockets = await io.in(room).fetchSockets();
  // RemoteSocket.leave() is async; await every leave so eviction is fully
  // complete before this resolves. Callers emit right after evicting, and the
  // emit must not race a still-in-flight leave (or the evicted socket would
  // still receive that broadcast).
  await Promise.all(
    sockets
      .filter((s) => {
        const data = s.data as { userId?: number; rol?: string };
        return data?.userId === userId && data?.rol !== "admin";
      })
      .map((s) => s.leave(room)),
  );
}

// Fully disconnect every socket belonging to a user, across all rooms. Used when
// an account is deleted: the user must lose all live access immediately, not just
// be removed from a single session room. Admin sockets are disconnected too here
// because a deleted account has no business staying connected.
export async function disconnectUser(userId: number): Promise<void> {
  if (!io) return;
  const sockets = await io.fetchSockets();
  await Promise.all(
    sockets
      .filter((s) => (s.data as { userId?: number })?.userId === userId)
      .map((s) => s.disconnect(true)),
  );
}

// Broadcast a list-level signal to every authenticated client (the lobby).
// Clients react by invalidating their session-list / stats caches and refetching
// over REST, so a newly created or newly opened session appears instantly.
export function emitLobbyEvent(event: LobbyEvent): void {
  throttledEmit(`${LOBBY_ROOM}|${event}`, LOBBY_ROOM, event, {});
}

// Signal a single member (all their tabs/devices) that their own access changed:
// an admin retired / re-admitted / marked them absent, or (de)activated their
// account. Delivered on the per-user room so it lands even when the member is no
// longer in the session room. Throttled per user to bound bursts.
export function emitUserEvent(userId: number, event: UserEvent): void {
  const room = userRoomFor(userId);
  throttledEmit(`${room}|${event}`, room, event, { userId });
}
