import { institutionIdColumn } from "./institutions";
import { pgTable, integer, numeric, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { plenariasTable } from "./sessions";

// Per-session snapshot of every member's voting weights, frozen when the
// session is created (or when a late-created member first joins it). Later
// edits to users.voting_weight / voting_weight_alt must never retro-affect
// the totals, quorums, or denominators of sessions that already exist.
export const sessionWeightsTable = pgTable(
  "session_weights",
  {
    institutionId: institutionIdColumn(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => plenariasTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    weight: numeric("weight", { precision: 10, scale: 4 }).notNull().default("0"),
    weightAlt: numeric("weight_alt", { precision: 10, scale: 4 }).notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

export type SessionWeight = typeof sessionWeightsTable.$inferSelect;
