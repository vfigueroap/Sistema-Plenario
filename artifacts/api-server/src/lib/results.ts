import type { ElectorateSnapshot } from "@workspace/db";

export interface VoteBreakdown {
  favor: number;
  contra: number;
  abstención: number;
  sinVoto: number;
  ausente: number;
  total: number;
}

export interface TopicResultData {
  weights: VoteBreakdown;
  percentages: VoteBreakdown;
  approved: boolean | null;
  voteCount: number;
}

interface VoteLike {
  userId: number;
  option: string | null;
  weightAtVote: string;
}

interface MemberLike {
  id: number;
  votingWeight: string;
}

/**
 * Compute weighted results for a moción / single-candidate topic from pre-fetched data.
 * Vote weights use the frozen weight_at_vote; non-voters use current weight.
 * When `weighted` is false every vote and member counts as 1 (one-person-one-vote).
 * Non-voters who attended count as "sinVoto", non-voters who were absent as "ausente".
 *
 * Only members passed in `members` count toward sinVoto/ausente — callers must pass
 * the eligible-estamento subset so restricted votations use the right denominator.
 * Retirement excludes non-voters from later opportunities, never recorded votes.
 * Closed-topic denominators still require a historical electorate snapshot.
 */
export function computeTopicResult(
  topicStatus: string,
  votesForTopic: VoteLike[],
  members: MemberLike[],
  attendeeIds: Set<number>,
  checkedOutIds: Set<number> = new Set(),
  weighted = true,
  snapshot?: ElectorateSnapshot | null,
  useAlt = false,
): TopicResultData {
  if (snapshot) {
    votesForTopic = snapshot.votes;
    members = snapshot.members.map((m) => ({ ...m, votingWeight: useAlt ? m.votingWeightAlt : m.votingWeight }));
    attendeeIds = new Set(snapshot.attendeeIds);
    checkedOutIds = new Set(snapshot.checkedOutIds);
  }
  const voterIds = new Set(votesForTopic.map((v) => v.userId));

  let favor = 0;
  let contra = 0;
  let abstención = 0;
  let sinVoto = 0;
  let ausente = 0;

  for (const vote of votesForTopic) {
    const w = weighted ? parseFloat(vote.weightAtVote) : 1;
    if (vote.option === "favor") favor += w;
    else if (vote.option === "contra") contra += w;
    else if (vote.option === "abstención") abstención += w;
  }

  for (const member of members) {
    if (checkedOutIds.has(member.id)) continue;
    if (!voterIds.has(member.id)) {
      const w = weighted ? parseFloat(member.votingWeight) : 1;
      if (attendeeIds.has(member.id)) sinVoto += w;
      else ausente += w;
    }
  }

  const total = favor + contra + abstención + sinVoto + ausente;
  const pct = (w: number) => (total > 0 ? (w / total) * 100 : 0);

  const weights: VoteBreakdown = { favor, contra, abstención, sinVoto, ausente, total };
  const percentages: VoteBreakdown = {
    favor: pct(favor),
    contra: pct(contra),
    abstención: pct(abstención),
    sinVoto: pct(sinVoto),
    ausente: pct(ausente),
    total: 100,
  };

  const approved = topicStatus === "cerrado" ? favor > contra : null;

  return { weights, percentages, approved, voteCount: votesForTopic.length };
}

export interface CandidateResultData {
  candidateId: number;
  name: string;
  weight: number;
  count: number;
  percentage: number;
}

export interface CandidateTopicResult {
  candidates: CandidateResultData[];
  abstenciónWeight: number;
  abstenciónCount: number;
  sinVotoWeight: number;
  ausenteWeight: number;
  eligibleCount: number;
  votedCount: number;
  voteCount: number;
}

interface DetailVoteLike {
  userId: number;
  candidateId: number | null;
  weightAtVote: string;
}

interface CandidateLike {
  id: number;
  name: string;
}

/**
 * Compute results for a candidato (multiple) topic. Each detail row is one vote
 * unit; cumulative voting means several rows may share a candidateId. Percentages
 * are computed against the total allocated weight (candidates + abstención), so a
 * bloc's share reflects only cast votes. sinVoto/ausente are reported separately
 * (ballot-level participation) and are not part of the percentage denominator.
 */
export function computeCandidateResult(
  detailVotes: DetailVoteLike[],
  candidates: CandidateLike[],
  members: MemberLike[],
  attendeeIds: Set<number>,
  checkedOutIds: Set<number>,
  ballotUserIds: Set<number>,
  weighted: boolean,
  snapshot?: ElectorateSnapshot | null,
  useAlt = false,
): CandidateTopicResult {
  if (snapshot) {
    detailVotes = snapshot.votes;
    ballotUserIds = new Set(snapshot.votes.map((v) => v.userId));
    members = snapshot.members.map((m) => ({ ...m, votingWeight: useAlt ? m.votingWeightAlt : m.votingWeight }));
    attendeeIds = new Set(snapshot.attendeeIds);
    checkedOutIds = new Set(snapshot.checkedOutIds);
  }
  const weightByCandidate = new Map<number, number>();
  const countByCandidate = new Map<number, number>();
  let abstenciónWeight = 0;
  let abstenciónCount = 0;

  for (const v of detailVotes) {
    const w = weighted ? parseFloat(v.weightAtVote) : 1;
    if (v.candidateId === null) {
      abstenciónWeight += w;
      abstenciónCount += 1;
    } else {
      weightByCandidate.set(v.candidateId, (weightByCandidate.get(v.candidateId) ?? 0) + w);
      countByCandidate.set(v.candidateId, (countByCandidate.get(v.candidateId) ?? 0) + 1);
    }
  }

  const allocatedWeight =
    abstenciónWeight + [...weightByCandidate.values()].reduce((s, w) => s + w, 0);
  const pct = (w: number) => (allocatedWeight > 0 ? (w / allocatedWeight) * 100 : 0);

  const candidateResults: CandidateResultData[] = candidates.map((c) => {
    const weight = weightByCandidate.get(c.id) ?? 0;
    return {
      candidateId: c.id,
      name: c.name,
      weight,
      count: countByCandidate.get(c.id) ?? 0,
      percentage: pct(weight),
    };
  });

  const voters = new Set(ballotUserIds);
  let sinVotoWeight = 0;
  let ausenteWeight = 0;
  // Recorded voters remain part of this topic even after leaving its live roster.
  const eligibleIds = new Set(voters);
  for (const member of members) {
    if (checkedOutIds.has(member.id)) continue;
    eligibleIds.add(member.id);
    if (!voters.has(member.id)) {
      const w = weighted ? parseFloat(member.votingWeight) : 1;
      if (attendeeIds.has(member.id)) sinVotoWeight += w;
      else ausenteWeight += w;
    }
  }

  return {
    candidates: candidateResults,
    abstenciónWeight,
    abstenciónCount,
    sinVotoWeight,
    ausenteWeight,
    eligibleCount: eligibleIds.size,
    votedCount: voters.size,
    voteCount: voters.size,
  };
}
