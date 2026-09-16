import { institutionIdColumn } from "./institutions";
import { unique, pgTable, text, serial, timestamp, numeric, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rolEnum = pgEnum("rol", ["admin", "miembro"]);

export const usersTable = pgTable("users", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  group: text("group"),
  faculty: text("faculty"),
  email: text("email"),
  password: text("password").notNull(),
  votingWeight: numeric("voting_weight", { precision: 10, scale: 4 }).notNull().default("0"),
  // Optional second ("alternative") weight; a votación restricted to an estamento
  // can opt to tally with this column instead of the standard votingWeight.
  votingWeightAlt: numeric("voting_weight_alt", { precision: 10, scale: 4 }).notNull().default("0"),
  // Deactivated accounts keep their profile + history but cannot participate and are
  // excluded from every weight total; they can still log in (shown a disabled notice).
  active: boolean("active").notNull().default(true),
  rol: rolEnum("rol").notNull().default("miembro"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("users_institution_id_id").on(t.institutionId, t.id),
  unique("users_institution_username").on(t.institutionId, t.username),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
