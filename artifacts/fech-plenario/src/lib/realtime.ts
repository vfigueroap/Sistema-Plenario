import { io, type Socket } from "socket.io-client";
import type { QueryClient } from "@tanstack/react-query";

export const usesRealtimePolling = import.meta.env.VITE_REALTIME_TRANSPORT === "polling";

const PULSE_URL = "/api/public/pulse";
const SAFETY_REFRESH_MS = 60000;
const UNMAPPED_MIN_INTERVAL_MS = 15000;
const PUBLIC_REFRESH_MS = 90000;
const PUBLIC_REFRESH_JITTER_MS = 10000;
const MEMBER_DRIVEN_COMPONENTS = ["a", "x"];

type Pulse = { v: string; c: Record<string, string> };

async function fetchPulse(): Promise<Pulse | null> {
  try {
    const response = await fetch(PULSE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { v?: unknown; c?: unknown };
    if (typeof body.v !== "string" || typeof body.c !== "object" || body.c === null) return null;
    return { v: body.v, c: body.c as Record<string, string> };
  } catch {
    return null;
  }
}

export function pulseComponentsFor(queryKey: readonly unknown[]): string[] | null {
  const path = typeof queryKey[0] === "string" ? queryKey[0] : "";
  if (/^\/api\/sessions\/\d+\/attendance/.test(path)) return ["a", "s"];
  if (/^\/api\/sessions\/\d+\/agenda/.test(path)) return ["g"];
  if (/^\/api\/sessions\/\d+\/speaking-turns/.test(path)) return ["w", "s"];
  if (/^\/api\/sessions\/\d+\/topics/.test(path)) return ["t", "x"];
  if (/^\/api\/topics\//.test(path)) return ["t", "x"];
  if (/^\/api\/sessions(\/\d+)?$/.test(path)) return ["s"];
  return null;
}

// One timer per QueryClient even when user, lobby and session hooks coexist.
// Each tick asks a tiny shared endpoint what changed and only refreshes the
// mounted, enabled queries that depend on it. REST remains the authorization boundary.
const pollers = new WeakMap<QueryClient, { users: number; stop: () => void }>();

export function subscribeRealtimePolling(client: QueryClient): () => void {
  let poller = pollers.get(client);
  if (!poller) {
    let running = false;
    let last: Pulse | null = null;
    let lastFullRefresh = Date.now();
    const safetyMs = SAFETY_REFRESH_MS + Math.floor(Math.random() * SAFETY_REFRESH_MS);
    const refresh = async (force = false) => {
      if (running || document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true;
      try {
        const pulse = await fetchPulse();
        const now = Date.now();
        const full = force || now - lastFullRefresh >= safetyMs;
        const changed = new Set<string>();
        if (pulse && last) {
          for (const [key, value] of Object.entries(pulse.c)) if (last.c[key] !== value) changed.add(key);
        }
        if (pulse) last = pulse;
        if (!window.location.pathname.includes("/admin")) for (const component of MEMBER_DRIVEN_COMPONENTS) changed.delete(component);
        if (!full && changed.size === 0) return;
        if (full) lastFullRefresh = now;
        await client.refetchQueries(
          {
            type: "active",
            predicate: (query) => {
              if (query.state.fetchStatus === "fetching") return false;
              if (full) return true;
              const components = pulseComponentsFor(query.queryKey);
              if (components) return components.some((c) => changed.has(c));
              return now - query.state.dataUpdatedAt >= UNMAPPED_MIN_INTERVAL_MS;
            },
          },
          { cancelRefetch: false },
        );
      } finally {
        running = false;
      }
    };
    const onVisible = () => void refresh(true);
    // Jitter spreads clients across time; slow requests never get cancelled by
    // the next tick. Catch-up after visibility/network recovery is immediate.
    const timer = setInterval(() => void refresh(), 3000 + Math.floor(Math.random() * 1000));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    poller = {
      users: 0,
      stop: () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", onVisible);
      },
    };
    pollers.set(client, poller);
  }
  poller.users++;
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--poller.users === 0) {
      poller.stop();
      pollers.delete(client);
    }
  };
}

export function subscribePublicRefresh(client: QueryClient): () => void {
  let last = Date.now();
  let running = false;
  const refresh = async () => {
    if (running || document.visibilityState === "hidden" || !navigator.onLine || Date.now() - last < PUBLIC_REFRESH_MS) return;
    running = true;
    last = Date.now();
    try {
      await client.refetchQueries(
        {
          type: "active",
          predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/public/"),
        },
        { cancelRefetch: false },
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void refresh(), PUBLIC_REFRESH_MS + Math.floor(Math.random() * PUBLIC_REFRESH_JITTER_MS));
  const onVisible = () => void refresh();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onVisible);
  };
}

// Must match the server's Socket.io path. The connection is same-origin and
// routes through the local reverse proxy, which dispatches "/api" to the API
// server. Paths are not rewritten, so the path must live under "/api".
const SOCKET_PATH = "/api/socket.io";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: !usesRealtimePolling,
      path: SOCKET_PATH,
      withCredentials: true,
      // Reconnect indefinitely with capped backoff; until the socket is back,
      // the UI degrades gracefully to React Query polling.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}
