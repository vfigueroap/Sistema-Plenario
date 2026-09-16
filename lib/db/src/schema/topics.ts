import { institutionIdColumn } from "./institutions";
import { pgTable, text, serial, integer, boolean, timestamp, pgEnum, index, unique, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plenariasTable } from "./sessions";
import { agendaPointsTable } from "./agenda";

export const topicStatusEnum = pgEnum("topic_status", ["abierto", "cerrado"]);

export interface ElectorateMember {
  id: number;
  displayName: string;
  username: string;
  group: string | null;
  faculty: string | null;
  votingWeight: string;
  votingWeightAlt: string;
}

export interface ElectorateSnapshot {
  capturedAt: string;
  members: ElectorateMember[];
  attendeeIds: number[];
  checkedOutIds: number[];
  votes: { userId: number; candidateId: number | null; option: string | null; weightAtVote: string }[];
}

export const topicsTable = pgTable(
  "vote_topics",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => plenariasTable.id, { onDelete: "cascade" }),
    agendaPointId: integer("agenda_point_id").references(() => agendaPointsTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    // Optional longer description shown under the title on the ballot/results.
    detail: text("detail"),
    status: topicStatusEnum("status").notNull().default("cerrado"),
    // "mocion" (favor/contra/abstención) | "candidato" (named candidates)
    type: text("type").notNull().default("mocion"),
    // For type=candidato: "single" (one candidate, favor/contra) | "multiple" (N cumulative votes)
    candidateMode: text("candidate_mode"),
    // Whether the tally uses voting weight (true) or one-person-one-vote (false)
    weighted: boolean("weighted").notNull().default(true),
    // Which weight column to tally with: "normal" (votingWeight) | "alt" (votingWeightAlt).
    // Only meaningful when weighted=true; typically chosen for estamento-restricted votes.
    weightSource: text("weight_source").notNull().default("normal"),
    // Number of votes each voter may cast (candidato multiple); 1 otherwise
    votesPerVoter: integer("votes_per_voter").notNull().default(1),
    // Null means no verified closure snapshot exists (including imported history).
    electorateSnapshot: jsonb("electorate_snapshot").$type<ElectorateSnapshot>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Topics are always queried by session; index the FK (Postgres doesn't auto-index FKs).
  (t) => [index("idx_vote_topics_session").on(t.sessionId)],
);

// Named candidates for type=candidato votations.
export const topicCandidatesTable = pgTable(
  "vote_topic_candidates",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    voteTopicId: integer("vote_topic_id").notNull().references(() => topicsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("idx_vote_topic_candidates_topic").on(t.voteTopicId)],
);

// Which estamentos are eligible to vote on a topic. No rows => open to everyone.
// estamentoName matches users.group (and estamentos.name).
export const topicEstamentosTable = pgTable(
  "vote_topic_estamentos",
  {
    institutionId: institutionIdColumn(),
    id: serial("id").primaryKey(),
    voteTopicId: integer("vote_topic_id").notNull().references(() => topicsTable.id, { onDelete: "cascade" }),
    estamentoName: text("estamento_name").notNull(),
  },
  (t) => [unique("vote_topic_estamentos_topic_name").on(t.voteTopicId, t.estamentoName)],
);

export const insertTopicSchema = createInsertSchema(topicsTable).omit({ id: true, createdAt: true });
export type InsertTopic = z.infer<typeof insertTopicSchema>;
export type Topic = typeof topicsTable.$inferSelect;
export type TopicCandidate = typeof topicCandidatesTable.$inferSelect;
export type TopicEstamento = typeof topicEstamentosTable.$inferSelect;
