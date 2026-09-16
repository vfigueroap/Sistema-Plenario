import { io, type Socket } from "socket.io-client";
import type { QueryClient } from "@tanstack/react-query";

export const usesRealtimePolling = import.meta.env.VITE_REALTIME_TRANSPORT === "polling";

// One timer per QueryClient even when user, lobby and session hooks coexist.
// Refresh only mounted, enabled queries: REST remains the authorization boundary.
const pollers = new WeakMap<QueryClient, { users: number; stop: () => void }>();

export function subscribeRealtimePolling(client: QueryClient): () => void {
  let poller = pollers.get(client);
  if (!poller) {
    let running = false;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true;
      try {
        await client.refetchQueries(
          { type: "active", predicate: (query) => query.state.fetchStatus !== "fetching" },
          { cancelRefetch: false },
        );
      } finally {
        running = false;
      }
    };
    // Jitter spreads clients across time; slow requests never get cancelled by
    // the next tick. Catch-up after visibility/network recovery is immediate.
    const timer = setInterval(() => void refresh(), 3000 + Math.floor(Math.random() * 1000));
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    poller = {
      users: 0,
      stop: () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("online", refresh);
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
