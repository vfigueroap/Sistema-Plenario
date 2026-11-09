import type { Response } from "express";
import { currentInstitutionId, withInstitutionDb } from "@workspace/db";

const TTL_MS = process.env.NODE_ENV === "test" ? 0 : 1500;
const MAX_ENTRIES = 512;

type Entry = { generation: number; expiresAt: number; promise: Promise<unknown> };

const entries = new Map<string, Entry>();
let generation = 0;

export function clearSharedCache(): void {
  generation += 1;
  entries.clear();
}

export async function sharedValue<T>(key: string, load: () => Promise<T>): Promise<T> {
  key = `${currentInstitutionId() ?? process.env.INSTITUTION_ID ?? "test"}:${key}`;
  const now = Date.now();
  const current = entries.get(key);
  if (current && current.generation === generation && current.expiresAt > now) {
    try {
      return (await current.promise) as T;
    } catch {
      return load();
    }
  }
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const startedAt = generation;
  const entry: Entry = { generation: startedAt, expiresAt: Infinity, promise: Promise.resolve().then(load) };
  entries.set(key, entry);
  entry.promise.then(
    () => {
      if (entries.get(key) !== entry) return;
      if (generation !== startedAt) entries.delete(key);
      else entry.expiresAt = Date.now() + TTL_MS;
    },
    () => {
      if (entries.get(key) === entry) entries.delete(key);
    },
  );
  return (await entry.promise) as T;
}

export async function sendShared(
  res: Response,
  key: string,
  load: () => Promise<{ status: number; body: unknown }>,
): Promise<void> {
  const shared = await sharedValue(key, async () => {
    const institutionId = res.locals.sharedReadInstitutionId as string | undefined;
    const { status, body } = institutionId ? await withInstitutionDb(institutionId, load) : await load();
    return { status, text: JSON.stringify(body) };
  });
  res.status(shared.status).type("application/json").send(shared.text);
}
