import { institutionIdColumn } from "./institutions";
import { boolean, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const regularSpeakersTable = pgTable("regular_speakers", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("regular_speakers_institution_name").on(t.institutionId, t.name),
]);

export type RegularSpeaker = typeof regularSpeakersTable.$inferSelect;
