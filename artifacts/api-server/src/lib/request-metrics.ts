import type { RequestHandler } from "express";
import { logger } from "./logger";

type RouteMetric = { requests: number; errors: number; totalMs: number; maxMs: number };

export function requestMetrics(): RequestHandler {
  const routes = new Map<string, RouteMetric>();
  let since = Date.now();
  let cpu = process.cpuUsage();
  return (req, res, next) => {
    const started = performance.now();
    const path = req.path.replace(/\/\d+(?=\/|$)/g, "/:id");
    const key = `${req.method} ${path}`;
    res.once("finish", () => {
      if (!routes.has(key) && routes.size >= 100) return;
      const metric = routes.get(key) ?? { requests: 0, errors: 0, totalMs: 0, maxMs: 0 };
      const elapsed = performance.now() - started;
      metric.requests++;
      metric.errors += Number(res.statusCode >= 400);
      metric.totalMs += elapsed;
      metric.maxMs = Math.max(metric.maxMs, elapsed);
      routes.set(key, metric);
      if (res.statusCode >= 500) logger.error({ route: key, status: res.statusCode, durationMs: Math.round(elapsed) }, "Solicitud fallida");
      const now = Date.now();
      if (now - since < 60000) return;
      const consumed = process.cpuUsage(cpu);
      logger.info({
        periodMs: now - since,
        processCpuMs: (consumed.user + consumed.system) / 1000,
        routes: Object.fromEntries([...routes].map(([route, value]) => [route, {
          requests: value.requests,
          errors: value.errors,
          averageMs: Math.round(value.totalMs / value.requests),
          maxMs: Math.round(value.maxMs),
        }])),
      }, "Uso agregado de la API");
      routes.clear();
      since = now;
      cpu = process.cpuUsage();
    });
    next();
  };
}
