import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAttendanceQueryKey,
  getListSpeakingTurnsQueryKey,
  getListSessionsQueryKey,
  getGetSessionQueryKey,
  getListTopicsQueryKey,
  getListAgendaPointsQueryKey,
  getGetTopicResultsQueryKey,
  getGetTopicBallotsQueryKey,
} from "@workspace/api-client-react";
import { getSocket, usesRealtimePolling, subscribeRealtimePolling } from "@/lib/realtime";
import {
  scheduleInvalidate,
  scheduleInvalidateAll,
  scheduleInvalidatePredicate,
} from "@/lib/live-invalidate";

/**
 * Subscribe to live updates for a session over Socket.io.
 *
 * Joins the `session:<id>` room and, on each server event, invalidates the
 * matching React Query caches so the affected views refetch instantly. The
 * REST endpoints remain the source of truth — events only signal "refetch".
 *
 * When the socket is disconnected the UI degrades gracefully: components keep
 * their (larger-interval) polling as a fallback. The returned `connected` flag
 * can be used to surface connection state in the UI.
 */
export function useSessionLive(sessionId: number | undefined): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  // Tracks whether this socket has already connected once, so we can tell a
  // genuine reconnect (after a drop) apart from the initial connect.
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    if (usesRealtimePolling) return subscribeRealtimePolling(queryClient);
    const socket = getSocket();

    const join = () => {
      setConnected(true);
      socket.emit("join", sessionId);
      // On a reconnect (not the first connect) we may have missed events while
      // the socket was down. The fallback poll is only every 30s, so catch up
      // immediately by refetching everything on screen (jittered to avoid a
      // reconnect stampede after a server restart).
      if (hasConnectedRef.current) {
        scheduleInvalidateAll(queryClient);
      }
      hasConnectedRef.current = true;
    };
    const onDisconnect = () => setConnected(false);

    // Jittered + coalesced invalidation: when one server event fans out to ~200
    // clients, refetching immediately on all of them stampedes the API. Spread
    // the refetches over a short random window and collapse rapid repeats.
    const invalidate = (keys: readonly (readonly unknown[])[]) => {
      for (const queryKey of keys) {
        scheduleInvalidate(queryClient, queryKey);
      }
    };

    // Member status (present/retired/absent) changed, so every topic in the
    // session is affected: the nominal ballot list AND the weighted tally
    // (retiring/re-including a member changes the percentages and shifts weight
    // into/out of "sin voto"/"ausente"). There's no per-topic key at this level,
    // so invalidate the whole ballots + results families by URL prefix. Jittered
    // + coalesced so a mark-attendance rush at session start doesn't stampede.
    const invalidateAllTopicViews = () =>
      scheduleInvalidatePredicate(
        queryClient,
        `session:${sessionId}:topic-views`,
        (q) =>
          typeof q.queryKey[0] === "string" &&
          q.queryKey[0].startsWith("/api/topics/") &&
          (q.queryKey[0].endsWith("/ballots") || q.queryKey[0].endsWith("/results")),
      );

    const onAttendance = () => {
      invalidate([
        getListAttendanceQueryKey(sessionId),
        getGetSessionQueryKey(sessionId),
      ]);
      invalidateAllTopicViews();
    };
    const onSpeaking = () =>
      invalidate([getListSpeakingTurnsQueryKey(sessionId)]);
    const onSession = () =>
      invalidate([
        getListSessionsQueryKey(),
        getGetSessionQueryKey(sessionId),
        getListTopicsQueryKey(sessionId),
        getListAgendaPointsQueryKey(sessionId),
      ]);
    const onVotes = (payload: { topicId?: number }) => {
      if (typeof payload?.topicId === "number") {
        invalidate([
          getGetTopicResultsQueryKey(payload.topicId),
          getGetTopicBallotsQueryKey(payload.topicId),
        ]);
      }
    };
    // This member's own access to the session changed (an admin retired,
    // re-admitted, or marked them absent). They may have just been evicted from
    // the room, so re-join to resubscribe (a no-op server-side if they're no
    // longer eligible) and refresh the on-screen session views immediately —
    // otherwise a retired/re-admitted member's ballot + results would sit stale
    // until the 30s fallback poll.
    const onAccess = () => {
      socket.emit("join", sessionId);
      onAttendance();
    };

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("attendance:changed", onAttendance);
    socket.on("speaking:changed", onSpeaking);
    socket.on("session:changed", onSession);
    socket.on("votes:changed", onVotes);
    socket.on("access:changed", onAccess);

    // If already connected (singleton reused across mounts), join immediately.
    if (socket.connected) join();

    return () => {
      socket.emit("leave", sessionId);
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("attendance:changed", onAttendance);
      socket.off("speaking:changed", onSpeaking);
      socket.off("session:changed", onSession);
      socket.off("votes:changed", onVotes);
      socket.off("access:changed", onAccess);
    };
  }, [sessionId, queryClient]);

  return { connected };
}
