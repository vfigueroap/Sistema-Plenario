import type { QueryClient } from "@tanstack/react-query";

/**
 * Schedule a jittered, coalesced React Query invalidation.
 *
 * When a single server event fans out to ~200 connected clients, invalidating
 * immediately makes all of them refetch the same endpoint in the same instant —
 * a thundering herd against the API and DB pool. Instead we:
 *   - coalesce: repeated calls for the same query key within the jitter window
 *     collapse into a single refetch, so rapid-fire events don't stack up, and
 *   - jitter: each client waits a random 0–maxDelayMs before refetching, so the
 *     herd spreads over a short window instead of hitting simultaneously.
 *
 * The delay stays small enough to keep the "instant" feel for a human watching.
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleInvalidate(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  maxDelayMs = 1000,
): void {
  const id = JSON.stringify(queryKey);
  if (pending.has(id)) return; // already scheduled within the window → coalesce
  const delay = Math.floor(Math.random() * maxDelayMs);
  const timer = setTimeout(() => {
    pending.delete(id);
    void queryClient.invalidateQueries({ queryKey });
  }, delay);
  pending.set(id, timer);
}

/**
 * Schedule a jittered, coalesced invalidation of every cached query matching a
 * predicate, coalesced under a caller-supplied `id`.
 *
 * Used when one event invalidates a whole *family* of queries that share a URL
 * prefix but differ by id (e.g. every `/api/topics/:id/results` in a session):
 * there is no single query key to pass to `scheduleInvalidate`. Same jitter +
 * coalescing rules as `scheduleInvalidate` so a fan-out to ~200 clients doesn't
 * stampede the API.
 */
export function scheduleInvalidatePredicate(
  queryClient: QueryClient,
  id: string,
  predicate: (query: { queryKey: readonly unknown[] }) => boolean,
  maxDelayMs = 1000,
): void {
  if (pending.has(id)) return; // already scheduled within the window → coalesce
  const delay = Math.floor(Math.random() * maxDelayMs);
  const timer = setTimeout(() => {
    pending.delete(id);
    void queryClient.invalidateQueries({ predicate });
  }, delay);
  pending.set(id, timer);
}

/**
 * Schedule a jittered, coalesced invalidation of ALL active queries.
 *
 * Used to catch up after a socket reconnect: while the socket was briefly down
 * the client may have missed events, so on reconnect we refetch everything that
 * is on screen. The same jitter applies — when the server restarts, ~200 clients
 * reconnect at once, and an un-jittered full refetch from all of them would
 * stampede the API. Coalesced under a single id so one reconnect = one wave.
 */
export function scheduleInvalidateAll(
  queryClient: QueryClient,
  maxDelayMs = 1000,
): void {
  const id = "__all__";
  if (pending.has(id)) return; // already scheduled within the window → coalesce
  const delay = Math.floor(Math.random() * maxDelayMs);
  const timer = setTimeout(() => {
    pending.delete(id);
    void queryClient.invalidateQueries();
  }, delay);
  pending.set(id, timer);
}
