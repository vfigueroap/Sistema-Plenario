export type DetailRow = { candidateId: number | null; option: string | null };
// Resource ceiling, not a voting rule: reject before expanding allocation rows.
export const MAX_VOTES_PER_VOTER = 1000;
type BuildRowsResult =
  | { ok: true; rows: DetailRow[] }
  | { ok: false; status: number; error: string };

// Validate a candidato allocation set (single or multiple mode) and expand it
// into the per-vote detail rows to persist. Shared by the member vote endpoint
// and the admin override so both apply identical rules (max-1-per-option in
// multiple mode, abstención remainder auto-filled, exact count in single mode).
export function buildCandidatoRows(
  topic: { candidateMode: string | null; votesPerVoter: number },
  allocationsRaw: unknown,
  validCandidateIds: Set<number>,
): BuildRowsResult {
  if (!Number.isSafeInteger(topic.votesPerVoter) || topic.votesPerVoter < 1 ||
      topic.votesPerVoter > MAX_VOTES_PER_VOTER) {
    return { ok: false, status: 400, error: "Cantidad de votos por votante inválida" };
  }
  const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : null;
  if (!allocations) {
    return { ok: false, status: 400, error: "Debes enviar tu asignación de votos" };
  }
  const rows: DetailRow[] = [];

  if (topic.candidateMode === "multiple") {
    // Approval-style: each option may be chosen at most ONCE. Any of the voter's
    // votes not used become abstención, computed from votesPerVoter.
    const chosen = new Set<number>();
    for (const a of allocations) {
      const count = Number(a?.count);
      if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
        return { ok: false, status: 400, error: "Asignación inválida" };
      }
      if (count === 0) continue;
      const cid = a?.candidateId === null || a?.candidateId === undefined ? null : Number(a.candidateId);
      // Abstención is derived from the leftover votes, never sent explicitly.
      if (cid === null) continue;
      if (!validCandidateIds.has(cid)) {
        return { ok: false, status: 400, error: "Candidate inválide" };
      }
      if (count > 1 || chosen.has(cid)) {
        return { ok: false, status: 400, error: "No puedes votar más de una vez por la misma opción" };
      }
      chosen.add(cid);
    }
    if (chosen.size > topic.votesPerVoter) {
      return { ok: false, status: 400, error: `Puedes elegir hasta ${topic.votesPerVoter} opción(es)` };
    }
    for (const cid of chosen) rows.push({ candidateId: cid, option: null });
    const abstentions = topic.votesPerVoter - chosen.size;
    for (let i = 0; i < abstentions; i++) rows.push({ candidateId: null, option: null });
  } else {
    // single-candidate: exactly one allocation (candidate or abstención).
    let totalCount = 0;
    for (const a of allocations) {
      const count = Number(a?.count);
      if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
        return { ok: false, status: 400, error: "Asignación inválida" };
      }
      if (count === 0) continue;
      const cid = a?.candidateId === null || a?.candidateId === undefined ? null : Number(a.candidateId);
      if (cid !== null && !validCandidateIds.has(cid)) {
        return { ok: false, status: 400, error: "Candidate inválide" };
      }
      totalCount += count;
      if (totalCount > topic.votesPerVoter) {
        return { ok: false, status: 400, error: `Debes asignar exactamente ${topic.votesPerVoter} voto(s)` };
      }
      for (let i = 0; i < count; i++) rows.push({ candidateId: cid, option: null });
    }
    if (totalCount !== topic.votesPerVoter) {
      return { ok: false, status: 400, error: `Debes asignar exactamente ${topic.votesPerVoter} voto(s)` };
    }
  }

  return { ok: true, rows };
}
