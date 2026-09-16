import { describe, expect, it } from "vitest";
import { buildCandidatoRows } from "../lib/candidate-votes";

const candidates = new Set([1, 2]);

describe("candidate ballot validation", () => {
  it("keeps single candidate votes and abstention", () => {
    const topic = { candidateMode: "single", votesPerVoter: 1 };
    expect(buildCandidatoRows(topic, [{ candidateId: 1, count: 1 }], candidates))
      .toEqual({ ok: true, rows: [{ candidateId: 1, option: null }] });
    expect(buildCandidatoRows(topic, [{ candidateId: null, count: 1 }], candidates))
      .toEqual({ ok: true, rows: [{ candidateId: null, option: null }] });
  });

  it("fills unused multiple votes with abstention", () => {
    expect(buildCandidatoRows({ candidateMode: "multiple", votesPerVoter: 2 },
      [{ candidateId: 1, count: 1 }], candidates)).toEqual({
      ok: true, rows: [{ candidateId: 1, option: null }, { candidateId: null, option: null }],
    });
  });

  it("rejects repeated choices", () => {
    expect(buildCandidatoRows({ candidateMode: "multiple", votesPerVoter: 2 },
      [{ candidateId: 1, count: 1 }, { candidateId: 1, count: 1 }], candidates).ok).toBe(false);
  });

  it.each([0, -1, 1.5, 1001, Infinity, Number.MAX_SAFE_INTEGER])("rejects invalid votesPerVoter=%s", (votesPerVoter) => {
    expect(buildCandidatoRows({ candidateMode: "multiple", votesPerVoter },
      [], candidates).ok).toBe(false);
  });

  it("rejects an oversized allocation before expanding it", () => {
    expect(buildCandidatoRows({ candidateMode: "single", votesPerVoter: 1 },
      [{ candidateId: 1, count: Number.MAX_SAFE_INTEGER }], candidates).ok).toBe(false);
  });
});
