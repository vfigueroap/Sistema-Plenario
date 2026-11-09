import fs from "node:fs";

const members = 120;
const visitors = 200;
const cpuUsedSeconds = 26 * 60 + 11;
const remainingCpuSeconds = 4 * 3600 - cpuUsedSeconds;
const cpuPerInvocationSeconds = cpuUsedSeconds / 25462;
const scenarios = [];
for (const hours of [2, 4]) {
  const seconds = hours * 3600;
  const initialAndActions = 8000 * hours / 2;
  for (const version of ["antes", "después"]) {
    const pulseInterval = version === "antes" ? 3.5 : 15;
    const privateReads = version === "antes"
      ? members * Math.ceil(seconds / 90) * 6
      : members * (Math.ceil(seconds / 300) * 5 + Math.ceil(seconds / 60));
    const publicRefreshSeconds = version === "antes" ? 90 : 600;
    const publicRequests = visitors * Math.ceil(seconds / publicRefreshSeconds) * 2;
    const pulses = members * Math.ceil(seconds / pulseInterval);
    const browserRequests = privateReads + publicRequests + pulses + initialAndActions;
    for (const cacheNodes of [1, 10, 0]) {
      const originPublic = cacheNodes === 0 ? publicRequests + pulses
        : cacheNodes * (Math.ceil(seconds / (version === "antes" ? 2 : 5)) + Math.ceil(seconds / 60) + Math.ceil(seconds / 30));
      const invocations = privateReads + initialAndActions + originPublic;
      const cpuSeconds = invocations * cpuPerInvocationSeconds;
      scenarios.push({
        version, hours, cacheNodes, publicRefreshSeconds, browserRequests, invocations,
        estimatedCpuMinutes: Math.round(cpuSeconds / 60 * 10) / 10,
        remainingCpuPercent: Math.round(cpuSeconds / remainingCpuSeconds * 1000) / 10,
        estimatedMemoryGBhAtHistoricalAverage: Math.round(invocations * 16.9 / 25462 * 10) / 10,
        withinCpuGoal: cpuSeconds <= remainingCpuSeconds * (hours === 2 ? 0.3 : 0.6),
      });
    }
  }
}
const result = {
  generatedAt: new Date().toISOString(),
  source: "Usage aportado por el usuario del 9 de noviembre de 2026",
  members, visitors, remainingCpuSeconds, cpuPerInvocationSeconds,
  method: [
    "Modelo de solicitudes, no medición de facturación ni garantía de capacidad en Vercel",
    "Después, el reloj virtual ejecuta el poller real durante dos horas con seis consultas activas y mide 480 pulsos y 240 lecturas por integrante",
    "Antes, modelo del código previo con intervalo medio de 3,5 s y seis lecturas cada 90 s",
    "Después se usa el extremo conservador de seguridad cada 300 s, sin el ahorro de pestañas ocultas ni sesiones cerradas",
    "Se añaden 8000 invocaciones privadas por cada dos horas para llegada, acciones, cambios de pantalla, administración y refrescos por cambios",
    "CDN ideal con 1 o 10 nodos independientes y una renovación por TTL y ruta; cero nodos representa ningún acierto de caché",
    "La caché evita invocar la función, pero todas las solicitudes siguen contando en CDN",
    "CPU y memoria se extrapolan de promedios históricos, no de las latencias HTTP ni de la CPU del equipo local",
    "Una caché con menos aciertos, más pestañas, archivos grandes o más acciones cambia el resultado",
  ],
  scenarios,
};
fs.writeFileSync(new URL("./results/cpu-quota-estimate.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.table(scenarios);
