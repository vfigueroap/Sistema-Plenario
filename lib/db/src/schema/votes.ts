import { institutionIdColumn } from "./institutions";
import { pgTable, serial, integer, text, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { topicsTable, topicCandidatesTable } from "./topics";

// One row per voter per topic. Acts as the "has voted" marker and concurrency
// guard (unique voteTopicId+userId), and freezes the voter's weight at vote time.
export const voteBallotsTable = pgTable(
  "vote_ballots",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    voteTopicId: integer("vote_topic_id").notNull().references(() => topicsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    weightAtVote: numeric("weight_at_vote", { precision: 10, scale: 4 }).notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("vote_ballots_topic_user").on(t.voteTopicId, t.userId)],
);

// Detail rows. For moción / candidato-single: one row with `option` set.
// For candidato-multiple: up to votesPerVoter rows, each with `candidateId`
// (or null = abstención). Cumulative voting => multiple rows may share candidateId.
export const votesTable = pgTable("votes", {
  institutionId: institutionIdColumn(),
  id: serial("id").primaryKey(),
  voteTopicId: integer("vote_topic_id").notNull().references(() => topicsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ballotId: integer("ballot_id").references(() => voteBallotsTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").references(() => topicCandidatesTable.id, { onDelete: "cascade" }),
  option: text("option"), // favor | contra | abstención (moción/single); null for candidato-multiple detail
  weightAtVote: numeric("weight_at_vote", { precision: 10, scale: 4 }).notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVoteSchema = createInsertSchema(votesTable).omit({ id: true, timestamp: true });
export type InsertVote = z.infer<typeof insertVoteSchema>;
export type Vote = typeof votesTable.$inferSelect;
export type VoteBallot = typeof voteBallotsTable.$inferSelect;
