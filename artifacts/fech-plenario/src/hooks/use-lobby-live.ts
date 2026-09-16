import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSessionsQueryKey,
  getGetStatsQueryKey,
} from "@workspace/api-client-react";
import { getSocket, usesRealtimePolling, subscribeRealtimePolling } from "@/lib/realtime";
import { scheduleInvalidate } from "@/lib/live-invalidate";

/**
 * Subscribe to list-level live updates over Socket.io.
 *
 * Every authenticated client is auto-joined to the server's "lobby" room, so
 * when any session is created, opened, closed, or deleted the server emits a
 * `sessions:changed` signal. On that signal we invalidate the session-list and
 * stats caches so a newly created or newly opened session appears instantly for
 * everyone — not after the next polling tick.
 *
 * The REST endpoints remain the source of truth; the event only signals
 * "refetch". When the socket is down, components keep their polling fallback.
 */
export function useLobbyLive(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (usesRealtimePolling) return subscribeRealtimePolling(queryClient);
    const socket = getSocket();

    // Jittered + coalesced: a single session open/close fans out to every
    // connected client, so spread the refetches instead of stampeding at once.
    const onSessions = () => {
      scheduleInvalidate(queryClient, getListSessionsQueryKey());
      scheduleInvalidate(queryClient, getGetStatsQueryKey());
    };

    socket.on("sessions:changed", onSessions);

    return () => {
      socket.off("sessions:changed", onSessions);
    };
  }, [queryClient]);
}
