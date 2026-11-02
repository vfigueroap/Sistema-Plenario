import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export async function purgeUserSessions(userId: number, keepSid?: string): Promise<void> {
  await db.execute(
    sql`DELETE FROM session WHERE (sess::jsonb ->> 'userId')::int = ${userId} AND (${keepSid ?? null}::text IS NULL OR sid <> ${keepSid ?? null}::text)`,
  );
}
