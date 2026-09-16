import { institutionIdColumn } from "./institutions";
import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { plenariasTable } from "./sessions";

// Admin-only "Inasistencia Justificada": operationally identical to a normal
// absence (NO attendance row exists — the member never counts toward quorum
// nor becomes vote-eligible). This table only records the *label* so the
// public panel, the member's history, and the Excel export can display
// "Inasistencia Justificada" instead of plain "Ausente".
export const justifiedAbsencesTable = pgTable(
  "justified_absences",
  {
    institutionId: institutionIdColumn(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => plenariasTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

export type JustifiedAbsence = typeof justifiedAbsencesTable.$inferSelect;
