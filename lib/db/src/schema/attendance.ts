import { institutionIdColumn } from "./institutions";
import { pgTable, serial, integer, timestamp, unique, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { plenariasTable } from "./sessions";

export const attendanceModalityEnum = pgEnum("attendance_modality", ["online", "presencial"]);

export const attendanceTable = pgTable("attendance", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => plenariasTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  modality: attendanceModalityEnum("modality").notNull().default("presencial"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
}, (t) => [
  unique("attendance_session_user").on(t.sessionId, t.userId),
]);

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, timestamp: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
