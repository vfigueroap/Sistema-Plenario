import { sql } from "drizzle-orm";
import type { db, ElectorateSnapshot } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller holds the topic row lock. One statement captures a consistent roster. */
export async function captureElectorate(tx: Transaction, topicId: number): Promise<ElectorateSnapshot> {
  const result = await tx.execute(sql`
    SELECT jsonb_build_object(
      'capturedAt', now(),
      'votes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'userId', v.user_id, 'candidateId', v.candidate_id,
        'option', v.option, 'weightAtVote', v.weight_at_vote::text
      ) ORDER BY v.id) FROM votes v WHERE v.vote_topic_id = t.id), '[]'::jsonb),
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', u.id, 'displayName', u.display_name, 'username', u.username,
          'group', u."group", 'faculty', u.faculty,
          'votingWeight', COALESCE(w.weight, u.voting_weight)::text,
          'votingWeightAlt', COALESCE(w.weight_alt, u.voting_weight_alt)::text
        ) ORDER BY u.id)
        FROM users u
        LEFT JOIN session_weights w ON w.user_id = u.id AND w.session_id = t.session_id
        WHERE u.rol = 'miembro' AND (
          (u.active AND (u.created_at <= s.created_at OR EXISTS (
            SELECT 1 FROM attendance a WHERE a.session_id = t.session_id AND a.user_id = u.id
          )) AND (NOT EXISTS (SELECT 1 FROM vote_topic_estamentos e WHERE e.vote_topic_id = t.id)
            OR EXISTS (SELECT 1 FROM vote_topic_estamentos e WHERE e.vote_topic_id = t.id AND e.estamento_name = u."group")))
          OR EXISTS (SELECT 1 FROM votes v WHERE v.vote_topic_id = t.id AND v.user_id = u.id)
        )
      ), '[]'::jsonb),
      'attendeeIds', COALESCE((SELECT jsonb_agg(a.user_id) FROM attendance a WHERE a.session_id = t.session_id AND a.checked_out_at IS NULL), '[]'::jsonb),
      'checkedOutIds', COALESCE((SELECT jsonb_agg(a.user_id) FROM attendance a WHERE a.session_id = t.session_id AND a.checked_out_at IS NOT NULL), '[]'::jsonb)
    ) AS snapshot
    FROM vote_topics t JOIN plenarias s ON s.id = t.session_id WHERE t.id = ${topicId}
  `);
  const snapshot = result.rows[0]?.snapshot as ElectorateSnapshot | undefined;
  if (!snapshot) throw new Error("Cannot snapshot a missing topic");
  return snapshot;
}
