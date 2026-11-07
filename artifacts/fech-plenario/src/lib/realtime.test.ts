import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  window.history.pushState({}, "", "/admin/sessions/1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function stubPulse(next: () => Record<string, string>) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    const c = next();
    return { ok: true, json: async () => ({ v: JSON.stringify(c), c }) };
  }));
}

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

  it("maps query keys to the pulse components they depend on", async () => {
    const { pulseComponentsFor } = await import("./realtime");
    expect(pulseComponentsFor(["/api/sessions/4/attendance"])).toEqual(["a", "s"]);
    expect(pulseComponentsFor(["/api/sessions/4/agenda"])).toEqual(["g"]);
    expect(pulseComponentsFor(["/api/sessions/4/speaking-turns"])).toEqual(["w", "s"]);
    expect(pulseComponentsFor(["/api/sessions/4/topics"])).toEqual(["t", "x"]);
    expect(pulseComponentsFor(["/api/topics/9/results"])).toEqual(["t", "x"]);
    expect(pulseComponentsFor(["/api/sessions"])).toEqual(["s"]);
    expect(pulseComponentsFor(["/api/messages"])).toBeNull();
  });

  it("refreshes only changed components, pauses hidden tabs and cleans up", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let pulse = { s: "1", a: "1", g: "1", w: "1", t: "1", x: "1" };
    stubPulse(() => pulse);
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let attendance = 1;
    let agenda = 1;
    const fetchAttendance = vi.fn(async () => attendance);
    const fetchAgenda = vi.fn(async () => agenda);
    const attendanceObserver = new QueryObserver(client, { queryKey: ["/api/sessions/1/attendance"], queryFn: fetchAttendance });
    const agendaObserver = new QueryObserver(client, { queryKey: ["/api/sessions/1/agenda"], queryFn: fetchAgenda });
    const unobserveAttendance = attendanceObserver.subscribe(() => {});
    const unobserveAgenda = agendaObserver.subscribe(() => {});
    await attendanceObserver.refetch();
    await agendaObserver.refetch();
    const inactive = vi.fn(async () => 1);
    await client.fetchQuery({ queryKey: ["inactive"], queryFn: inactive });
    const stop1 = subscribeRealtimePolling(client);
    const stop2 = subscribeRealtimePolling(client);
    const attendanceCalls = fetchAttendance.mock.calls.length;
    const agendaCalls = fetchAgenda.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchAttendance.mock.calls.length).toBe(attendanceCalls);
    expect(fetchAgenda.mock.calls.length).toBe(agendaCalls);

    attendance = 2;
    pulse = { ...pulse, a: "2" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(2);
    expect(fetchAttendance.mock.calls.length).toBe(attendanceCalls + 1);
    expect(fetchAgenda.mock.calls.length).toBe(agendaCalls);
    expect(inactive).toHaveBeenCalledOnce();

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    attendance = 3;
    pulse = { ...pulse, a: "3" };
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(2);
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(3);

    stop1();
    attendance = 4;
    pulse = { ...pulse, a: "4" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(4);
    stop2();
    attendance = 5;
    pulse = { ...pulse, a: "5" };
    await vi.advanceTimersByTimeAsync(6000);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(4);
    unobserveAttendance();
    unobserveAgenda();
    client.clear();
  });

  it("does not refetch while the pulse stays unchanged, except for the safety refresh", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    stubPulse(() => ({ s: "same", a: "same" }));
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchAttendance = vi.fn(async () => 1);
    const observer = new QueryObserver(client, { queryKey: ["/api/sessions/1/attendance"], queryFn: fetchAttendance });
    const unobserve = observer.subscribe(() => {});
    await observer.refetch();
    const stop = subscribeRealtimePolling(client);
    const baseline = fetchAttendance.mock.calls.length;
    await vi.advanceTimersByTimeAsync(54000);
    expect(fetchAttendance.mock.calls.length).toBe(baseline);
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetchAttendance.mock.calls.length).toBe(baseline + 1);
    stop();
    unobserve();
    client.clear();
  });

  it("does not cancel or duplicate slow requests and skips disabled queries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let ticks = 0;
    stubPulse(() => ({ a: String(++ticks) }));
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient();
    let finish!: (value: number) => void;
    const slow = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    const observer = new QueryObserver(client, {
      queryKey: ["/api/sessions/1/attendance"], queryFn: slow, initialData: 1, staleTime: Infinity,
    });
    const disabledFetch = vi.fn(async () => 1);
    const disabled = new QueryObserver(client, { queryKey: ["/api/sessions/1/agenda"], queryFn: disabledFetch, enabled: false });
    const unobserve = observer.subscribe(() => {});
    const unobserveDisabled = disabled.subscribe(() => {});
    const stop = subscribeRealtimePolling(client);
    await vi.advanceTimersByTimeAsync(12000);
    expect(slow).toHaveBeenCalledOnce();
    expect(disabledFetch).not.toHaveBeenCalled();
    finish(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(["/api/sessions/1/attendance"])).toBe(2);
    stop();
    unobserve();
    unobserveDisabled();
    client.clear();
  });
  it.each([["/member", false], ["/admin/sessions/1", true]])("reacts to attendance and vote changes only on admin screens (%s)", async (path, reacts) => {
    window.history.pushState({}, "", path);
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let pulse = { s: "1", a: "1", x: "1", t: "1" };
    stubPulse(() => pulse);
    const { subscribeRealtimePolling } = await import("./realtime");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchAttendance = vi.fn(async () => 1);
    const fetchTopics = vi.fn(async () => 1);
    const attendance = new QueryObserver(client, { queryKey: ["/api/sessions/1/attendance"], queryFn: fetchAttendance });
    const topics = new QueryObserver(client, { queryKey: ["/api/sessions/1/topics"], queryFn: fetchTopics });
    const unobserveAttendance = attendance.subscribe(() => {});
    const unobserveTopics = topics.subscribe(() => {});
    await attendance.refetch();
    await topics.refetch();
    const stop = subscribeRealtimePolling(client);
    await vi.advanceTimersByTimeAsync(3000);
    const attendanceCalls = fetchAttendance.mock.calls.length;
    const topicCalls = fetchTopics.mock.calls.length;

    pulse = { ...pulse, a: "2" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchAttendance.mock.calls.length).toBe(attendanceCalls + (reacts ? 1 : 0));

    pulse = { ...pulse, t: "2" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchTopics.mock.calls.length).toBe(topicCalls + 1);
    stop();
    unobserveAttendance();
    unobserveTopics();
    client.clear();
  });

  it("refreshes the public page every ninety seconds and pauses on hidden tabs", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { subscribePublicRefresh } = await import("./realtime");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchHistory = vi.fn(async () => 1);
    const observer = new QueryObserver(client, { queryKey: ["/api/public/history"], queryFn: fetchHistory });
    const unobserve = observer.subscribe(() => {});
    const fetchOther = vi.fn(async () => 1);
    const other = new QueryObserver(client, { queryKey: ["/api/sessions"], queryFn: fetchOther });
    const unobserveOther = other.subscribe(() => {});
    await observer.refetch();
    await other.refetch();
    const otherBaseline = fetchOther.mock.calls.length;
    const baseline = fetchHistory.mock.calls.length;
    const stop = subscribePublicRefresh(client);
    await vi.advanceTimersByTimeAsync(89000);
    expect(fetchHistory.mock.calls.length).toBe(baseline);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchHistory.mock.calls.length).toBe(baseline + 1);
    expect(fetchOther.mock.calls.length).toBe(otherBaseline);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(200000);
    expect(fetchHistory.mock.calls.length).toBe(baseline + 1);
    visibility.mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(91000);
    expect(fetchHistory.mock.calls.length).toBe(baseline + 2);
    stop();
    await vi.advanceTimersByTimeAsync(200000);
    expect(fetchHistory.mock.calls.length).toBe(baseline + 2);
    unobserve();
    unobserveOther();
    client.clear();
  });
});
