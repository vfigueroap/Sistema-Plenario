import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("REST realtime polling", () => {
  it("does not open a socket in polling mode", async () => {
    vi.stubEnv("VITE_REALTIME_TRANSPORT", "polling");
    const { getSocket } = await import("./realtime");
    const socket = getSocket();
    const active = socket.active;
    socket.disconnect();
    expect(active).toBe(false);
    expect(socket.connected).toBe(false);
  });

  it("shares a poller, refreshes active queries, pauses hidden tabs and cleans up", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let version = 1;
    const fetchMe = vi.fn(async () => version);
    const observer = new QueryObserver(client, { queryKey: ["/api/auth/me"], queryFn: fetchMe });
    const unobserve = observer.subscribe(() => {});
    await observer.refetch();
    const inactive = vi.fn(async () => 1);
    await client.fetchQuery({ queryKey: ["inactive"], queryFn: inactive });
    const stop1 = subscribeRealtimePolling(client);
    const stop2 = subscribeRealtimePolling(client);
    const initialCalls = fetchMe.mock.calls.length;
    version = 2;
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.getQueryData(["/api/auth/me"])).toBe(2);
    expect(fetchMe.mock.calls.length).toBe(initialCalls + 1);
    expect(inactive).toHaveBeenCalledOnce();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    version = 3;
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.getQueryData(["/api/auth/me"])).toBe(2);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(["/api/auth/me"])).toBe(3);
    stop1();
    version = 4;
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.getQueryData(["/api/auth/me"])).toBe(4);
    stop2();
    version = 5;
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.getQueryData(["/api/auth/me"])).toBe(4);
    unobserve();
    client.clear();
  });

  it("does not cancel or duplicate slow requests and skips disabled queries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient();
    let finish!: (value: number) => void;
    const slow = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    const observer = new QueryObserver(client, {
      queryKey: ["slow"], queryFn: slow, initialData: 1, staleTime: Infinity,
    });
    const disabledFetch = vi.fn(async () => 1);
    const disabled = new QueryObserver(client, { queryKey: ["disabled"], queryFn: disabledFetch, enabled: false });
    const unobserve = observer.subscribe(() => {});
    const unobserveDisabled = disabled.subscribe(() => {});
    const stop = subscribeRealtimePolling(client);
    await vi.advanceTimersByTimeAsync(12000);
    expect(slow).toHaveBeenCalledOnce();
    expect(disabledFetch).not.toHaveBeenCalled();
    finish(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(["slow"])).toBe(2);
    stop();
    unobserve();
    unobserveDisabled();
    client.clear();
  });
});
