import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("respeta los 15 segundos y rechaza configuraciones que aumentan el consumo", async () => {
  vi.stubEnv("VITE_POLL_INTERVAL_MS", "3000");
  expect((await import("./realtime")).pollIntervalMs).toBe(15000);
  vi.resetModules();
  vi.stubEnv("VITE_POLL_INTERVAL_MS", "30000");
  expect((await import("./realtime")).pollIntervalMs).toBe(30000);
});

it("pausa al cerrar el pleno y retoma con Actualizar, visibilidad o apertura local", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  let live = false;
  const fetchPulse = vi.fn(async () => ({ ok: true, json: async () => ({ v: String(live), c: { s: String(live) }, live }) }));
  vi.stubGlobal("fetch", fetchPulse);
  const { subscribeRealtimePolling, refreshActiveQueries } = await import("./realtime");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, { queryKey: ["/api/sessions"], initialData: [], staleTime: Infinity, queryFn: async () => live ? [{ status: "abierta" }] : [] });
  const unobserve = observer.subscribe(() => {});
  const stop = subscribeRealtimePolling(client);
  await vi.advanceTimersByTimeAsync(300000);
  expect(fetchPulse).toHaveBeenCalledTimes(1);
  live = true;
  await refreshActiveQueries(client);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetchPulse).toHaveBeenCalledTimes(2);
  live = false;
  await vi.advanceTimersByTimeAsync(300000);
  expect(fetchPulse).toHaveBeenCalledTimes(3);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchPulse).toHaveBeenCalledTimes(4);
  live = true;
  client.setQueryData(["/api/sessions"], [{ status: "abierta" }]);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetchPulse).toHaveBeenCalledTimes(5);
  stop(); unobserve(); client.clear();
});

it("espacia fallos de red sin multiplicar lecturas y recupera al volver la conexión", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  const fetchPulse = vi.fn(async () => { throw new Error("offline"); });
  vi.stubGlobal("fetch", fetchPulse);
  const { subscribeRealtimePolling } = await import("./realtime");
  const client = new QueryClient();
  const refetch = vi.spyOn(client, "refetchQueries");
  const stop = subscribeRealtimePolling(client);
  await vi.advanceTimersByTimeAsync(89000);
  expect(fetchPulse).toHaveBeenCalledTimes(2);
  expect(refetch).not.toHaveBeenCalled();
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(300000);
  expect(fetchPulse).toHaveBeenCalledTimes(2);
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchPulse).toHaveBeenCalledTimes(3);
  stop(); client.clear();
});

it("mide dos horas virtuales sin cambios con seis consultas visibles y un solo poller", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
  let pulses = 0;
  vi.stubGlobal("fetch", async () => { pulses++; return { ok: true, json: async () => ({ v: "same", c: { s: "1", a: "1", t: "1", w: "1", g: "1" }, live: true }) }; });
  const { subscribeRealtimePolling } = await import("./realtime");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls = new Map<string, number>();
  const unobserves = ["/api/auth/me", "/api/sessions", ...["attendance", "topics", "speaking-turns", "agenda"].map((suffix) => `/api/sessions/1/${suffix}`)].map((key) => {
    const observer = new QueryObserver(client, { queryKey: [key], initialData: {}, staleTime: Infinity, queryFn: async () => { calls.set(key, (calls.get(key) ?? 0) + 1); return {}; } });
    return observer.subscribe(() => {});
  });
  const stops = [subscribeRealtimePolling(client), subscribeRealtimePolling(client), subscribeRealtimePolling(client)];
  await vi.advanceTimersByTimeAsync(7200000 - 1);
  expect(pulses).toBe(480);
  expect(calls.get("/api/auth/me")).toBe(24);
  expect(calls.get("/api/sessions/1/topics")).toBe(24);
  expect([...calls.values()].reduce((a, b) => a + b, 0)).toBe(144);
  stops.forEach((stop) => stop()); unobserves.forEach((stop) => stop()); client.clear();
});

it("al volver a la pestaña consulta versiones y solo descarga los apartados modificados", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  let topicVersion = "1";
  const fetchPulse = vi.fn(async () => ({ ok: true, json: async () => ({ v: topicVersion, c: { t: topicVersion, a: "1" }, live: true }) }));
  vi.stubGlobal("fetch", fetchPulse);
  const { subscribeRealtimePolling } = await import("./realtime");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const topics = vi.fn(async () => []);
  const attendance = vi.fn(async () => []);
  const unobserves = [["topics", topics], ["attendance", attendance]].map(([path, queryFn]) => {
    const observer = new QueryObserver(client, { queryKey: [`/api/sessions/1/${path}`], initialData: [], staleTime: Infinity, queryFn: queryFn as typeof topics });
    return observer.subscribe(() => {});
  });
  const stop = subscribeRealtimePolling(client);
  await vi.advanceTimersByTimeAsync(0);
  expect(topics).toHaveBeenCalledTimes(1);
  expect(attendance).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 10; i++) {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(fetchPulse).toHaveBeenCalledTimes(11);
  expect(topics).toHaveBeenCalledTimes(1);
  expect(attendance).toHaveBeenCalledTimes(1);
  topicVersion = "2";
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(topics).toHaveBeenCalledTimes(2);
  expect(attendance).toHaveBeenCalledTimes(1);
  stop(); unobserves.forEach((unobserve) => unobserve()); client.clear();
});
