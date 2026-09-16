import { institutionIdColumn } from "./institutions";
import { unique, pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const unidadesAcademicasTable = pgTable("unidades_academicas", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("unidades_academicas_institution_id_id").on(t.institutionId, t.id),
  unique("unidades_academicas_institution_name").on(t.institutionId, t.name),
]);

export const insertUnidadAcademicaSchema = createInsertSchema(unidadesAcademicasTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUnidadAcademica = z.infer<typeof insertUnidadAcademicaSchema>;
export type UnidadAcademica = typeof unidadesAcademicasTable.$inferSelect;
