import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { withInstitutionDb } from "@workspace/db";

const CACHE_MS = 1000;
const CACHE_CONTROL = "public, max-age=0, s-maxage=5, must-revalidate";

type Pulse = { v: string; c: Record<string, string>; live: boolean };

const cache = new Map<string, { at: number; value?: Pulse; inflight?: Promise<Pulse> }>();

async function computePulse(institutionId: string): Promise<Pulse> {
  return withInstitutionDb(institutionId, async (tx) => {
    const result = await tx.execute(sql`
      select
        exists(select 1 from plenarias where status = 'abierta') as live,
        md5((select coalesce(string_agg(concat_ws(',', id, status, title, speaking_round_open, speaking_round_agenda_point_id, meeting_link, official_end_at), ';' order by id), '') from plenarias)) as s,
        md5((select concat_ws(',', count(*), count(checked_out_at), coalesce(max(id), 0)) from attendance)) as a,
        md5((select coalesce(string_agg(concat_ws(',', id, agenda_point_id, status, position, elapsed_seconds, duration_seconds, started_at, speaker_name, user_id), ';' order by id), '') from speaking_turns where status <> 'finalizada' or created_at > now() - interval '2 hours')) as w,
        md5((select coalesce(string_agg(concat_ws(',', id, status, title, coalesce(detail, ''), agenda_point_id), ';' order by id), '') from vote_topics where status = 'abierto' or created_at > now() - interval '12 hours')) as t,
        md5((select concat_ws(',', (select count(*) from votes), (select coalesce(max(id), 0) from votes), (select count(*) from vote_ballots), (select coalesce(max(id), 0) from vote_ballots)))) as x,
        md5((select coalesce(string_agg(concat_ws(',', id, title, position, estimated_minutes), ';' order by id), '') from agenda_points where session_id in (select id from plenarias where status = 'abierta'))) as g
    `);
    const row = result.rows[0] as Record<string, string> & { live: boolean };
    const c = { s: row.s, a: row.a, w: row.w, t: row.t, x: row.x, g: row.g };
    return { v: createHash("md5").update(Object.values(c).join("")).digest("hex"), c, live: row.live };
  });
}

async function currentPulse(institutionId: string): Promise<Pulse> {
  const now = Date.now();
  let entry = cache.get(institutionId);
  if (entry?.value && now - entry.at < CACHE_MS) return entry.value;
  if (!entry) {
    if (cache.size >= 100) {
      for (const [key, old] of cache) if (!old.inflight && now - old.at >= CACHE_MS) cache.delete(key);
    }
    entry = { at: 0 };
    cache.set(institutionId, entry);
  }
  const current = entry;
  if (!current.inflight) {
    current.inflight = computePulse(institutionId)
      .then((value) => {
        current.at = Date.now();
        current.value = value;
        return value;
      })
      .finally(() => {
        current.inflight = undefined;
      });
  }
  return current.inflight;
}

export function pulseHandler(institutionId: string) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const pulse = await currentPulse(institutionId);
      res.setHeader("Cache-Control", CACHE_CONTROL);
      res.json(pulse);
    } catch {
      res.status(503).setHeader("Cache-Control", "no-store").json({ error: "No disponible" });
    }
  };
}
