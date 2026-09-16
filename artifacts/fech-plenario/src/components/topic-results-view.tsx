import { useGetTopicResults, getGetTopicResultsQueryKey } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";

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

export function TopicResultsView({ topicId }: { topicId: number }) {
  const { data: results, isLoading } = useGetTopicResults(topicId, {
    // Realtime `votes:changed` drives instant updates; this poll is only a
    // fallback for when the socket is down (relaxed from 5s to cut load at scale).
    query: { refetchInterval: 30000, queryKey: getGetTopicResultsQueryKey(topicId) },
  });

  if (isLoading) return <Spinner />;
  if (!results) return null;

  const isCandidate = results.type === "candidato";

  if (isCandidate) {
    const candidates = [...(results.candidates ?? [])].sort((a, b) => b.weight - a.weight);
    return (
      <div className="space-y-3 mt-4">
        {candidates.length === 0 && (
          <div className="text-sm text-muted-foreground">Sin candidates.</div>
        )}
        {candidates.map((c, i) => (
          <div key={c.candidateId}>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">
                {c.weight.toFixed(2)} · {c.count} voto(s) ({c.percentage.toFixed(1)}%)
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                style={{ width: `${c.percentage}%` }}
                className={`h-full transition-all duration-500 ${CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]}`}
              />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm border-t pt-3">
          <div className="border-l-4 border-yellow-500 pl-2">
            <div className="font-semibold">Abstención</div>
            <div>{(results.abstenciónWeight ?? 0).toFixed(2)}</div>
          </div>
          <div className="border-l-4 border-gray-400 pl-2">
            <div className="font-semibold">Sin Voto</div>
            <div>{(results.sinVotoWeight ?? 0).toFixed(2)}</div>
          </div>
          <div className="border-l-4 border-gray-200 pl-2">
            <div className="font-semibold">Ausente</div>
            <div>{(results.ausenteWeight ?? 0).toFixed(2)}</div>
          </div>
          <div className="border-l-4 border-primary pl-2">
            <div className="font-semibold">Votaron</div>
            <div>{results.votedCount ?? 0} / {results.eligibleCount ?? 0}</div>
          </div>
        </div>
      </div>
    );
  }

  const percentages = results.percentages;
  const weights = results.weights;
  if (!percentages || !weights) return null;

  return (
    <div className="space-y-4 mt-4">
      <div className="flex h-6 w-full rounded-full overflow-hidden">
        <div style={{ width: `${percentages.favor}%` }} className="bg-lime-500 transition-all duration-500" />
        <div style={{ width: `${percentages.contra}%` }} className="bg-red-600 transition-all duration-500" />
        <div style={{ width: `${percentages.abstención}%` }} className="bg-yellow-500 transition-all duration-500" />
        <div style={{ width: `${percentages.sinVoto}%` }} className="bg-gray-400 transition-all duration-500" />
        <div style={{ width: `${percentages.ausente}%` }} className="bg-gray-200 transition-all duration-500" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
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
