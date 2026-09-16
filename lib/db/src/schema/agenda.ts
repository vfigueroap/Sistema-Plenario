import { institutionIdColumn } from "./institutions";
import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plenariasTable } from "./sessions";

export const agendaPointsTable = pgTable(
  "agenda_points",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => plenariasTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    estimatedMinutes: integer("estimated_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Agenda points are always queried by session; index the FK (no auto-index in Postgres).
  (t) => [index("idx_agenda_points_session").on(t.sessionId)],
);

export const insertAgendaPointSchema = createInsertSchema(agendaPointsTable).omit({ id: true, createdAt: true });
export type InsertAgendaPoint = z.infer<typeof insertAgendaPointSchema>;
export type AgendaPoint = typeof agendaPointsTable.$inferSelect;
