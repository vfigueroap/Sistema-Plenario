import { institutionIdColumn } from "./institutions";
import { pgTable, text, serial, integer, timestamp, unique, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { plenariasTable } from "./sessions";
import { agendaPointsTable } from "./agenda";

export const speakerCategoryEnum = pgEnum("speaker_category", ["pleno", "base"]);
export const speakingTurnKindEnum = pgEnum("speaking_turn_kind", ["individual", "colectiva"]);
export const speakingTurnStatusEnum = pgEnum("speaking_turn_status", [
  "en_cola",
  "hablando",
  "finalizada",
]);

export const speakingTurnsTable = pgTable("speaking_turns", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => plenariasTable.id, { onDelete: "cascade" }),
  agendaPointId: integer("agenda_point_id").references(() => agendaPointsTable.id, {
    onDelete: "set null",
  }),
  category: speakerCategoryEnum("category").notNull().default("pleno"),
  kind: speakingTurnKindEnum("kind").notNull().default("individual"),
  faculty: text("faculty"),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  speakerName: text("speaker_name"),
  durationSeconds: integer("duration_seconds").notNull().default(60),
  elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  status: speakingTurnStatusEnum("status").notNull().default("en_cola"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The speaking queue is always listed by session; index the FK (no auto-index in Postgres).
  index("idx_speaking_turns_session").on(t.sessionId),
]);

export const speakingTurnParticipantsTable = pgTable(
  "speaking_turn_participants",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    turnId: integer("turn_id")
      .notNull()
      .references(() => speakingTurnsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
  },
  (t) => [unique("speaking_turn_participant").on(t.turnId, t.userId)],
);

export const insertSpeakingTurnSchema = createInsertSchema(speakingTurnsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSpeakingTurn = z.infer<typeof insertSpeakingTurnSchema>;
export type SpeakingTurn = typeof speakingTurnsTable.$inferSelect;
export type SpeakingTurnParticipant = typeof speakingTurnParticipantsTable.$inferSelect;
