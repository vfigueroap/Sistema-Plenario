import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { getSocket, usesRealtimePolling, subscribeRealtimePolling } from "@/lib/realtime";

/**
 * Subscribe to the current member's per-user live channel.
 *
 * The server pushes `access:changed` on a room keyed to the user id (joined at
 * connection time) whenever an admin changes THIS member's access — retired,
 * re-admitted, marked absent, or (de)activated. Unlike session-room events this
 * reaches the member even after they've been evicted from a session room, so the
 * AuthGuard can flip to the "cuenta inhabilitada" screen the instant an admin
 * deactivates the account.
 *
 * No jitter/coalescing here: this is a per-user signal (fan-out of 1), not a
 * ~200-client broadcast, so there is no stampede to guard against.
 */
export function useUserLive(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (usesRealtimePolling) return subscribeRealtimePolling(queryClient);
    const socket = getSocket();
    const onAccess = () => {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    };
    socket.on("access:changed", onAccess);
    return () => {
      socket.off("access:changed", onAccess);
    };
  }, [queryClient]);
}
