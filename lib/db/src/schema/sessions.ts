import { institutionIdColumn } from "./institutions";
import { unique, pgTable, text, serial, timestamp, boolean, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionStatusEnum = pgEnum("session_status", ["abierta", "cerrada"]);

export const plenariasTable = pgTable("plenarias", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  location: text("location"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: sessionStatusEnum("status").notNull().default("cerrada"),
  sessionCode: text("session_code").notNull(),
  meetingLink: text("meeting_link"),
  actaObjectPath: text("acta_object_path"),
  actaFileName: text("acta_file_name"),
  speakingRoundOpen: boolean("speaking_round_open").notNull().default(false),
  speakingRoundAgendaPointId: integer("speaking_round_agenda_point_id"),
  // Horario oficial de la sesión. Solo se registra cuando la apertura se
  // declara oficial: una sesión abierta para probar o para preparar la tabla
  // no debe sumar horas al registro del pleno.
  //
  // `officialStartAt` nulo significa que esta sesión nunca se abrió
  // oficialmente, y por lo tanto no cuenta para el total de horas.
  officialStartAt: timestamp("official_start_at", { withTimezone: true }),
  officialEndAt: timestamp("official_end_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("plenarias_institution_id_id").on(t.institutionId, t.id),
  unique("plenarias_institution_session_code").on(t.institutionId, t.sessionCode),
]);

export const insertPlenariaSchema = createInsertSchema(plenariasTable).omit({ id: true, createdAt: true });
export type InsertPlenaria = z.infer<typeof insertPlenariaSchema>;
export type Plenaria = typeof plenariasTable.$inferSelect;
