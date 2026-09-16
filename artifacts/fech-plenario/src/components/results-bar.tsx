interface Breakdown {
  favor: number;
  contra: number;
  abstención: number;
  sinVoto: number;
  ausente: number;
  total: number;
}

interface Candidate {
  candidateId: number;
  name: string;
  weight: number;
  count: number;
  percentage: number;
}

const CANDIDATE_COLORS = [
  "bg-lime-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];

export function CandidateResultsBar({ candidates }: { candidates: Candidate[] }) {
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
  if (sorted.length === 0) return <div className="text-xs text-muted-foreground">Sin candidates.</div>;
  return (
    <div className="space-y-2">
      {sorted.map((c, i) => (
        <div key={c.candidateId}>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground">{c.weight.toFixed(2)} · {c.count} ({c.percentage.toFixed(1)}%)</span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div style={{ width: `${c.percentage}%` }} className={`h-full ${CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultsBar({
  percentages,
  weights,
}: {
  percentages?: Breakdown;
  weights?: Breakdown;
}) {
  if (!percentages || !weights) return null;
  return (
    <div className="space-y-3">
      <div className="flex h-5 w-full rounded-full overflow-hidden bg-gray-100">
        <div style={{ width: `${percentages.favor}%` }} className="bg-lime-500" />
        <div style={{ width: `${percentages.contra}%` }} className="bg-red-600" />
        <div style={{ width: `${percentages.abstención}%` }} className="bg-yellow-500" />
        <div style={{ width: `${percentages.sinVoto}%` }} className="bg-gray-400" />
        <div style={{ width: `${percentages.ausente}%` }} className="bg-gray-200" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
        <div className="border-l-4 border-lime-500 pl-2">
          <div className="font-semibold">Favor</div>
          <div>{weights.favor.toFixed(2)} ({percentages.favor.toFixed(1)}%)</div>
        </div>
        <div className="border-l-4 border-red-600 pl-2">
          <div className="font-semibold">Contra</div>
          <div>{weights.contra.toFixed(2)} ({percentages.contra.toFixed(1)}%)</div>
        </div>
        <div className="border-l-4 border-yellow-500 pl-2">
          <div className="font-semibold">Abst.</div>
          <div>{weights.abstención.toFixed(2)} ({percentages.abstención.toFixed(1)}%)</div>
        </div>
        <div className="border-l-4 border-gray-400 pl-2">
          <div className="font-semibold">Sin Voto</div>
          <div>{weights.sinVoto.toFixed(2)} ({percentages.sinVoto.toFixed(1)}%)</div>
        </div>
        <div className="border-l-4 border-gray-200 pl-2">
          <div className="font-semibold">Ausente</div>
          <div>{weights.ausente.toFixed(2)} ({percentages.ausente.toFixed(1)}%)</div>
        </div>
      </div>
    </div>
  );
}

export function MyVoteBadge({
  myVote,
  attended,
}: {
  myVote: string | null;
  attended: boolean;
}) {
  if (myVote) {
    const isStandard = myVote === "favor" || myVote === "contra" || myVote === "abstención";
    if (isStandard) {
      const cls =
        myVote === "favor"
          ? "bg-lime-50 text-lime-700 border-lime-200"
          : myVote === "contra"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-yellow-50 text-yellow-700 border-yellow-200";
      return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
          {myVote.toUpperCase()}
        </span>
      );
    }
    // Candidato vote summary (e.g. "Ana ×2, Beto ×1"): render as-is, no uppercase.
    return (
      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
        {myVote}
      </span>
    );
  }
  if (attended) {
    return (
      <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
        NO VOTÓ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      AUSENTE
    </span>
  );
}
