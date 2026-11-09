import type { RequestHandler } from "express";
import { withInstitutionDb } from "@workspace/db";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);

export function publicRead(
  load: () => Promise<unknown>,
  cacheControl: string,
  ttlMs = process.env.NODE_ENV === "test" ? 0 : 1500,
): RequestHandler {
  const entries = new Map<
    string,
    { expires: number; value: Promise<{ text: string; gzip: Buffer }> }
  >();
  return async (_req, res) => {
    const institutionId =
      process.env.INSTITUTION_ID ?? "00000000-0000-4000-8000-000000000001";
    let entry = entries.get(institutionId);
    if (!entry || entry.expires <= Date.now()) {
      if (entries.size >= 32) entries.clear();
      entry = {
        expires: Infinity,
        value: withInstitutionDb(institutionId, async () =>
          JSON.stringify(await load()),
        ).then(async (text) => ({ text, gzip: await compress(text) })),
      };
      entries.set(institutionId, entry);
      const created = entry;
      void entry.value.then(
        () => {
          created.expires = Date.now() + ttlMs;
        },
        () => {
          if (entries.get(institutionId) === created)
            entries.delete(institutionId);
        },
      );
    }
    try {
      const content = await entry.value;
      res.setHeader("Cache-Control", cacheControl);
      res.vary("Accept-Encoding");
      if (_req.acceptsEncodings("gzip")) {
        res.setHeader("Content-Encoding", "gzip");
        res.type("application/json").send(content.gzip);
      } else {
        res.type("application/json").send(content.text);
      }
    } catch (error) {
      _req.log?.error({ error }, "Public read failed");
      res
        .status(503)
        .setHeader("Cache-Control", "no-store")
        .json({ error: "No disponible" });
    }
  };
}
