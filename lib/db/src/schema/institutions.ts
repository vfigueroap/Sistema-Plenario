import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const institutionsTable = pgTable("institutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SQL migrations own RLS, grants and composite FKs (including selective SET
// NULL). Do not use drizzle push to deploy this foundation: it cannot preserve
// all those constraints. This is a context default, NEVER a legacy tenant.
export function institutionIdColumn() {
  return uuid("institution_id").notNull()
    .default(sql`nullif(current_setting('app.institution_id', true), '')::uuid`)
    .references(() => institutionsTable.id);
}
