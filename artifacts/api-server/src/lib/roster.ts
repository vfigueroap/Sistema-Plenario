// Session-scoped membership: a member "exists" for a plenary session only if
// their account was created at or before the session was created. Members added
// later must never alter anything that predates them — no past rosters, no past
// quorums/denominators, no past absentee lists ("no cambia nada antes, solo
// después"). The one override is actual participation: if a member has an
// attendance row in the session (present or checked out), they belong to its
// roster regardless of creation dates.
export function scopeMembersToSession<M extends { id: number; createdAt: Date }>(
  members: M[],
  sessionCreatedAt: Date,
  participantIds: ReadonlySet<number>,
): M[] {
  const cutoff = new Date(sessionCreatedAt).getTime();
  return members.filter(
    (m) => new Date(m.createdAt).getTime() <= cutoff || participantIds.has(m.id),
  );
}
