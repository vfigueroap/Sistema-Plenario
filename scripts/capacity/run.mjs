import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { gunzipSync } from "node:zlib";

const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = require("pg");
const root = fileURLToPath(new URL("../../", import.meta.url));
const memberCount = Number(process.env.CAPACITY_MEMBERS ?? 110);
const visitorCount = Number(process.env.CAPACITY_VISITORS ?? 200);
for (const count of [memberCount, visitorCount])
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw new Error("Cantidad de participantes inválida");
const base = new URL(process.env.CAPACITY_BASE_URL ?? "http://127.0.0.1:5188");
const bases = (process.env.CAPACITY_BASE_URLS ?? base.href)
  .split(",")
  .map((value) => new URL(value));
let nextBase = 0;
const dbUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
for (const url of [...bases, dbUrl])
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Solo conexiones locales");
if (!/^\/[a-z0-9_]+_test$/.test(dbUrl.pathname) || dbUrl.search)
  throw new Error("Se requiere base _test");
const client = new Client({ connectionString: dbUrl.href });
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: memberCount + visitorCount,
  maxFreeSockets: memberCount + visitorCount,
  maxTotalSockets: memberCount + visitorCount,
});
await client.connect();
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "tmp/capacity-db.json"), "utf8"),
);
const countSql = () =>
  (
    fs
      .readFileSync(metadata.log, "utf8")
      .match(/LOG:  (?:statement:|execute )/g) ?? []
  ).length;
const report = {
  createdAt: new Date().toISOString(),
  members: memberCount,
  visitors: visitorCount,
  bcryptCost: 10,
  cdn: false,
  instances: bases.length,
  simulatedDatabaseRoundTripMs: Number(process.env.CAPACITY_DB_RTT_MS ?? 0),
  phases: [],
  checks: {},
};
const percentile = (rows, p) =>
  rows.length
    ? Math.round(
        [...rows].sort((a, b) => a.ms - b.ms)[
          Math.min(rows.length - 1, Math.ceil(rows.length * p) - 1)
        ].ms,
      )
    : 0;
async function call(actor, method, endpoint, body, label = endpoint) {
  const started = performance.now();
  try {
    const response = await new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        new URL(endpoint, bases[nextBase++ % bases.length]),
        {
          method,
          agent,
          headers: {
            Origin: "https://capacity.example",
            "X-Forwarded-Proto": "https",
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip",
            ...(payload
              ? { "Content-Length": Buffer.byteLength(payload) }
              : {}),
            ...(actor.cookie ? { Cookie: actor.cookie } : {}),
          },
          signal: AbortSignal.timeout(30000),
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => {
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks),
              encoding: res.headers["content-encoding"],
              cookie: res.headers["set-cookie"]?.[0],
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
    const { body: responseBody, cookie, encoding } = response;
    if (cookie) actor.cookie = cookie.split(";")[0];
    let data;
    if (!["publico", "panel", "pulso", "administrador"].includes(label)) {
      try {
        data = JSON.parse((encoding === "gzip" ? gunzipSync(responseBody) : responseBody).toString("utf8"));
      } catch {}
    }
    return {
      status: response.status,
      ms: performance.now() - started,
      bytes: responseBody.length,
      data,
      label,
    };
  } catch (error) {
    return {
      status: -1,
      ms: performance.now() - started,
      label,
      error: String(error.cause ?? error),
    };
  }
}
const admin = {};
async function adminCall(method, endpoint, body) {
  const result = await call(admin, method, endpoint, body);
  assert.ok(
    result.status >= 200 && result.status < 300,
    JSON.stringify(result),
  );
  return result.data;
}
function summarize(rows) {
  return {
    requests: rows.length,
    errors: rows.filter((r) => r.status < 200 || r.status >= 300).length,
    codes: rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {}),
    p50: percentile(rows, 0.5),
    p95: percentile(rows, 0.95),
    p99: percentile(rows, 0.99),
    max: percentile(rows, 1),
    overFiveSeconds: rows.filter((r) => r.ms > 5000).length,
    bytes: rows.reduce((total, row) => total + (row.bytes ?? 0), 0),
    failures: [
      ...new Set(rows.filter((r) => r.status < 0).map((r) => r.error)),
    ],
  };
}
async function phase(name, action) {
  const start = performance.now();
  const before = countSql();
  const rows = await action();
  await new Promise((r) => setTimeout(r, 100));
  const summary = {
    name,
    wallMs: Math.round(performance.now() - start),
    sql: countSql() - before,
    ...summarize(rows),
    groups: {},
  };
  for (const label of new Set(rows.map((r) => r.label)))
    summary.groups[label] = summarize(rows.filter((r) => r.label === label));
  report.phases.push(summary);
  console.log(JSON.stringify(summary));
  fs.writeFileSync(
    path.join(
      root,
      "tmp",
      `capacity-${process.env.CAPACITY_LABEL ?? "result"}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  return rows;
}
const members = Array.from({ length: memberCount }, (_, i) => ({
  username: `capacity_${i + 1}`,
}));
const publicWave = () =>
  Array.from({ length: visitorCount }, () =>
    ["/api/public/history", "/api/public/members"].map((p) =>
      call({}, "GET", p, undefined, "publico"),
    ),
  ).flat();
const warmup = await Promise.all(
  Array.from({ length: memberCount + visitorCount }, () =>
    call({}, "GET", "/api/healthz", undefined, "conexion"),
  ),
);
console.log(JSON.stringify({ connections: summarize(warmup) }));
await adminCall("POST", "/api/auth/login", {
  username: "capacity_admin",
  password: "capacity-test-password",
});
const session = await adminCall("POST", "/api/sessions", {
  title: "Capacidad ficticia",
  location: "Local",
});
await adminCall("PATCH", `/api/sessions/${session.id}`, { status: "abierta" });
const agenda = await adminCall("POST", `/api/sessions/${session.id}/agenda`, {
  title: "Punto ficticio",
});
const topic = await adminCall("POST", `/api/sessions/${session.id}/topics`, {
  title: "Moción ficticia de carga",
});
const arrivals = await phase("ingreso y llegada pública", () =>
  Promise.all([
    ...members.map((m) =>
      call(
        m,
        "POST",
        "/api/auth/login",
        { username: m.username, password: "capacity-test-password" },
        "ingreso",
      ),
    ),
    ...publicWave(),
  ]),
);
assert.equal(
  arrivals.filter((r) => r.label === "ingreso" && r.status === 200).length,
  memberCount,
);
await phase("asistencia y público", () =>
  Promise.all([
    ...members.map((m, i) =>
      call(
        m,
        "POST",
        `/api/sessions/${session.id}/attendance`,
        {
          sessionCode: session.sessionCode,
          modality: i % 2 ? "online" : "presencial",
        },
        "asistencia",
      ),
    ),
    ...publicWave(),
  ]),
);
await adminCall("PATCH", `/api/topics/${topic.id}`, { status: "abierto" });
await phase("voto y público", () =>
  Promise.all([
    ...members.map((m, i) =>
      call(
        m,
        "POST",
        `/api/topics/${topic.id}/vote`,
        { option: ["favor", "contra", "abstención"][i % 3] },
        "voto",
      ),
    ),
    ...publicWave(),
  ]),
);
await adminCall("POST", `/api/sessions/${session.id}/speaking-round`, {
  open: true,
  agendaPointId: agenda.id,
});
await phase("palabra y público", () =>
  Promise.all([
    ...members.map((m) =>
      call(
        m,
        "POST",
        `/api/sessions/${session.id}/speaking-turns`,
        { category: "pleno", agendaPointId: agenda.id },
        "palabra",
      ),
    ),
    ...publicWave(),
  ]),
);
const panels = [
  "/api/auth/me",
  "/api/sessions",
  ...["attendance", "agenda", "topics", "speaking-turns"].map(
    (p) => `/api/sessions/${session.id}/${p}`,
  ),
  `/api/topics/${topic.id}/results`,
  `/api/topics/${topic.id}/ballots`,
];
await phase("paneles y público", () =>
  Promise.all([
    ...members.flatMap((m) =>
      panels.map((p) => call(m, "GET", p, undefined, "panel")),
    ),
    ...publicWave(),
  ]),
);
const duration = Number(process.env.CAPACITY_SECONDS ?? 0);
const extraTopics = [];
if (duration > 0) {
  await phase(`uso mixto ${duration}s`, async () => {
    const rows = [];
    const stop = Date.now() + duration * 1000;
    const tasks = members.map(async (m, i) => {
      await new Promise((r) => setTimeout(r, i * 20));
      let tick = 0;
      while (Date.now() < stop) {
        rows.push(
          await call(m, "GET", "/api/public/pulse", undefined, "pulso"),
        );
        if (tick++ % 9 === 0)
          rows.push(
            ...(await Promise.all(
              panels.map((p) => call(m, "GET", p, undefined, "panel")),
            )),
          );
        await new Promise((r) => setTimeout(r, 3500));
      }
    });
    tasks.push(
      (async () => {
        while (Date.now() < stop) {
          rows.push(...(await Promise.all(publicWave())));
          await new Promise((r) =>
            setTimeout(r, Math.max(0, Math.min(90000, stop - Date.now()))),
          );
        }
      })(),
    );
    tasks.push(
      (async () => {
        await new Promise((r) => setTimeout(r, 10000));
        while (Date.now() < stop) {
          const nextTopic = await adminCall(
            "POST",
            `/api/sessions/${session.id}/topics`,
            { title: "Moción ficticia sostenida" },
          );
          await adminCall("PATCH", `/api/topics/${nextTopic.id}`, {
            status: "abierto",
          });
          rows.push(
            ...(await Promise.all(
              members.map((m) =>
                call(
                  m,
                  "POST",
                  `/api/topics/${nextTopic.id}/vote`,
                  { option: "favor" },
                  "voto sostenido",
                ),
              ),
            )),
          );
          await adminCall("PATCH", `/api/topics/${nextTopic.id}`, {
            status: "cerrado",
          });
          extraTopics.push(nextTopic.id);
          rows.push(
            ...(await Promise.all(
              members.map((m) =>
                call(
                  m,
                  "POST",
                  `/api/sessions/${session.id}/attendance/checkout`,
                  {},
                  "retiro",
                ),
              ),
            )),
          );
          rows.push(
            ...(await Promise.all(
              members.map((m) =>
                call(
                  m,
                  "POST",
                  `/api/sessions/${session.id}/attendance/rejoin`,
                  {},
                  "reingreso",
                ),
              ),
            )),
          );
          await new Promise((r) =>
            setTimeout(r, Math.max(0, Math.min(40000, stop - Date.now()))),
          );
        }
      })(),
    );
    tasks.push(
      (async () => {
        while (Date.now() < stop) {
          rows.push(
            ...(await Promise.all(
              panels.map((p) =>
                call(admin, "GET", p, undefined, "administrador"),
              ),
            )),
          );
          await new Promise((r) => setTimeout(r, 5000));
        }
      })(),
    );
    await Promise.all(tasks);
    return rows;
  });
}
report.checks = (
  await client.query(
    `select
  (select count(*)::int from attendance where session_id=$1) attendance,
  (select count(*)::int from vote_ballots where vote_topic_id=$2) ballots,
  (select count(*)::int from votes where vote_topic_id=$2) votes,
  (select count(*)::int from speaking_turns where session_id=$1) turns,
  (select count(distinct position)::int from speaking_turns where session_id=$1) positions,
  (select count(*)::int from votes v join session_weights sw on sw.session_id=$1 and sw.user_id=v.user_id where v.vote_topic_id=$2 and v.weight_at_vote<>sw.weight) incorrect_weights`,
    [session.id, topic.id],
  )
).rows[0];
assert.deepEqual(report.checks, {
  attendance: memberCount,
  ballots: memberCount,
  votes: memberCount,
  turns: memberCount,
  positions: memberCount,
  incorrect_weights: 0,
});
const duplicates = await Promise.all(
  Array.from({ length: 20 }, () =>
    call(members[0], "POST", `/api/topics/${topic.id}/vote`, {
      option: "favor",
    }),
  ),
);
assert.ok(duplicates.every((r) => r.status === 409));
report.checks.duplicateVotesRejected = 20;
const duplicateTurns = await Promise.all(
  Array.from({ length: 20 }, () =>
    call(members[0], "POST", `/api/sessions/${session.id}/speaking-turns`, {
      category: "pleno",
    }),
  ),
);
assert.ok(duplicateTurns.every((row) => row.status === 409));
report.checks.duplicateTurnsRejected = 20;
for (const id of extraTopics) {
  assert.equal(
    (
      await client.query(
        "select count(*)::int as n from vote_ballots where vote_topic_id=$1",
        [id],
      )
    ).rows[0].n,
    memberCount,
  );
}
report.checks.additionalBallots = memberCount * extraTopics.length;
report.passed = report.phases.every((phase) => phase.errors === 0);
report.underFiveSeconds = report.phases.every((phase) => phase.overFiveSeconds === 0);
await adminCall("PATCH", `/api/sessions/${session.id}`, { status: "cerrada" });
fs.writeFileSync(
  path.join(
    root,
    "tmp",
    `capacity-${process.env.CAPACITY_LABEL ?? "result"}.json`,
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ checks: report.checks }));
await client.end();
agent.destroy();
if (!report.passed) process.exitCode = 1;
