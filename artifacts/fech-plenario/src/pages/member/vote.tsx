import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetTopicResults, useCastVote, getGetTopicResultsQueryKey, type VoteAllocation } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useSessionLive } from "@/hooks/use-session-live";
import { TopicBallotsPanel } from "@/components/topic-ballots-panel";
import { ArrowLeft, CheckCircle2, RefreshCw, Users } from "lucide-react";

export default function MemberVote() {
  const params = useParams();
  const topicId = parseInt(params.topicId || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: topic, isLoading, isFetching, refetch } = useGetTopicResults(topicId, {
    query: {
      enabled: !!topicId,
      queryKey: getGetTopicResultsQueryKey(topicId),
      // Fallback poll while live sync catches the instant path. Kept modest so a
      // full room of voters doesn't stampede the API — realtime does the heavy
      // lifting; this only backstops a dropped socket.
      refetchInterval: 30000,
    },
  });
  const castVote = useCastVote();

  // Live sync: joining the session room keeps this ballot's percentages,
  // eligibility, and status instant while others vote / the admin retires
  // members or closes the moción. sessionId comes from the results payload;
  // undefined until the first load, which useSessionLive tolerates.
  useSessionLive(topic?.sessionId);

  const [selectedOption, setSelectedOption] = useState<"favor" | "contra" | "abstención" | null>(null);
  // Candidato-single: which candidate is picked ("null" = abstención).
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  // Candidato-multiple (approval-style): set of selected candidateIds, max 1 each.
  const [multiSelected, setMultiSelected] = useState<Set<number>>(new Set());

  const isCandidate = topic?.type === "candidato";
  const isMultiVote = isCandidate && topic?.candidateMode === "multiple";
  const votesPerVoter = topic?.votesPerVoter ?? 1;

  const usedVotes = multiSelected.size;
  const remaining = votesPerVoter - usedVotes;

  const toggleCandidate = (id: number) => {
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < votesPerVoter) {
        next.add(id);
      }
      return next;
    });
  };

  const handleVote = () => {
    const onSuccess = () => {
      toast({ title: "Voto registrado exitosamente" });
      queryClient.invalidateQueries({ queryKey: getGetTopicResultsQueryKey(topicId) });
    };
    const onError = (err: any) => {
      toast({ title: "Error al votar", description: err?.message || "Hubo un problema al registrar tu voto.", variant: "destructive" });
    };

    if (isMultiVote) {
      const allocations: VoteAllocation[] = Array.from(multiSelected).map((id) => ({
        candidateId: id,
        count: 1,
      }));
      castVote.mutate({ topicId, data: { allocations } }, { onSuccess, onError });
      return;
    }

    if (isCandidate) {
      if (!selectedCandidate) return;
      const allocations: VoteAllocation[] = [
        { candidateId: selectedCandidate === "null" ? null : Number(selectedCandidate), count: 1 },
      ];
      castVote.mutate({ topicId, data: { allocations } }, { onSuccess, onError });
      return;
    }

    if (!selectedOption) return;
    castVote.mutate({ topicId, data: { option: selectedOption } }, { onSuccess, onError });
  };

  if (isLoading) return <AppLayout><div className="flex justify-center p-12"><Spinner /></div></AppLayout>;
  if (!topic) return <AppLayout>Tema no encontrado</AppLayout>;

  const alreadyVoted = isCandidate
    ? (topic.myAllocations?.length ?? 0) > 0
    : !!topic.myVote;

  const notEligible = topic.eligible === false;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={() => setLocation("/member")} className="-ml-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Volver al panel
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        <Card className="border-2 border-primary/20 shadow-md">
          <CardHeader className="bg-primary/5 pb-8">
            <div className="text-sm text-muted-foreground uppercase tracking-widest mb-2 font-semibold">Boleta de Votación</div>
            <CardTitle className="text-3xl leading-tight">{topic.title}</CardTitle>
            {topic.detail && (
              <p className="mt-3 text-base text-muted-foreground whitespace-pre-line">{topic.detail}</p>
            )}
          </CardHeader>

          <CardContent className="p-8">
            {topic.status === "cerrado" ? (
              <div className="text-center py-8 text-muted-foreground">
                <div className="text-xl font-medium text-foreground mb-2">Moción Cerrada</div>
                <p>Esta moción ya no acepta votos.</p>
              </div>
            ) : notEligible ? (
              <div className="text-center py-8 text-muted-foreground">
                <div className="text-xl font-medium text-foreground mb-2">No habilitade</div>
                <p>Tu estamento no participa en esta votación.</p>
                <Button className="mt-8" onClick={() => setLocation("/member")}>Volver al panel</Button>
              </div>
            ) : alreadyVoted ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-16 h-16 text-lime-500 mx-auto mb-4" />
                <h3 className="text-2xl font-bold mb-2">Voto Registrado</h3>
                {isCandidate ? (
                  <div className="text-muted-foreground text-lg space-y-1">
                    {topic.myAllocations?.map((a) => {
                      const name =
                        a.candidateId === null
                          ? "Abstención"
                          : topic.candidates?.find((c) => c.candidateId === a.candidateId)?.name ?? "—";
                      return (
                        <div key={String(a.candidateId)}>
                          <strong className="text-foreground">{name}</strong>
                          {a.count > 1 ? ` ×${a.count}` : ""}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-lg">
                    Has votado: <strong className="text-foreground capitalize">{topic.myVote}</strong>
                  </p>
                )}
                <Button className="mt-8" onClick={() => setLocation("/member")}>Volver al panel</Button>
              </div>
            ) : isMultiVote ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg bg-primary/5 px-4 py-3">
                  <span className="font-medium">Opciones seleccionadas</span>
                  <span className={`text-lg font-bold ${usedVotes === votesPerVoter ? "text-lime-600" : "text-primary"}`}>
                    {usedVotes} / {votesPerVoter}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Puedes elegir hasta {votesPerVoter} opción(es), máximo una vez cada una. Los votos que no uses contarán como abstención.
                </p>
                {topic.candidates?.map((c) => {
                  const active = multiSelected.has(c.candidateId);
                  const disabled = !active && remaining <= 0;
                  return (
                    <button
                      key={c.candidateId}
                      disabled={disabled}
                      className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${active ? "border-primary bg-primary/5 text-primary shadow-sm" : disabled ? "border-gray-200 opacity-50 cursor-not-allowed" : "border-gray-200 hover:border-primary/40 hover:bg-gray-50"}`}
                      onClick={() => toggleCandidate(c.candidateId)}
                    >
                      <span className="font-bold">{c.name}</span>
                      <div className={`w-6 h-6 rounded-md border-2 ${active ? "border-primary bg-primary" : "border-gray-300"}`} />
                    </button>
                  );
                })}
              </div>
            ) : isCandidate ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Selecciona une candidate.</p>
                {topic.candidates?.map((c) => {
                  const key = String(c.candidateId);
                  const active = selectedCandidate === key;
                  return (
                    <button
                      key={c.candidateId}
                      className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${active ? "border-primary bg-primary/5 text-primary shadow-sm" : "border-gray-200 hover:border-primary/40 hover:bg-gray-50"}`}
                      onClick={() => setSelectedCandidate(key)}
                    >
                      <span className="font-bold">{c.name}</span>
                      <div className={`w-6 h-6 rounded-full border-2 ${active ? "border-primary bg-primary" : "border-gray-300"}`} />
                    </button>
                  );
                })}
                <button
                  className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${selectedCandidate === "null" ? "border-yellow-500 bg-yellow-50 text-yellow-900 shadow-sm" : "border-gray-200 hover:border-yellow-300 hover:bg-gray-50"}`}
                  onClick={() => setSelectedCandidate("null")}
                >
                  <span className="font-bold">Abstención</span>
                  <div className={`w-6 h-6 rounded-full border-2 ${selectedCandidate === "null" ? "border-yellow-500 bg-yellow-500" : "border-gray-300"}`} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${selectedOption === "favor" ? "border-lime-600 bg-lime-50 text-lime-900 shadow-sm" : "border-gray-200 hover:border-lime-300 hover:bg-gray-50"}`}
                  onClick={() => setSelectedOption("favor")}
                >
                  <span className="font-bold">A Favor</span>
                  <div className={`w-6 h-6 rounded-full border-2 ${selectedOption === "favor" ? "border-lime-600 bg-lime-600" : "border-gray-300"}`} />
                </button>

                <button
                  className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${selectedOption === "contra" ? "border-red-600 bg-red-50 text-red-900 shadow-sm" : "border-gray-200 hover:border-red-300 hover:bg-gray-50"}`}
                  onClick={() => setSelectedOption("contra")}
                >
                  <span className="font-bold">En Contra</span>
                  <div className={`w-6 h-6 rounded-full border-2 ${selectedOption === "contra" ? "border-red-600 bg-red-600" : "border-gray-300"}`} />
                </button>

                <button
                  className={`w-full p-6 text-xl rounded-xl border-2 transition-all flex justify-between items-center ${selectedOption === "abstención" ? "border-yellow-500 bg-yellow-50 text-yellow-900 shadow-sm" : "border-gray-200 hover:border-yellow-300 hover:bg-gray-50"}`}
                  onClick={() => setSelectedOption("abstención")}
                >
                  <span className="font-bold">Abstención</span>
                  <div className={`w-6 h-6 rounded-full border-2 ${selectedOption === "abstención" ? "border-yellow-500 bg-yellow-500" : "border-gray-300"}`} />
                </button>
              </div>
            )}
          </CardContent>

          {topic.status === "abierto" && !alreadyVoted && !notEligible && (
            <CardFooter className="bg-gray-50 p-6 border-t">
              <Button
                className="w-full text-lg h-14"
                size="lg"
                onClick={handleVote}
                disabled={
                  castVote.isPending ||
                  (isMultiVote
                    ? false
                    : isCandidate
                      ? !selectedCandidate
                      : !selectedOption)
                }
              >
                {isMultiVote && remaining > 0
                  ? `Confirmar (${remaining} como abstención)`
                  : "Confirmar y Emitir Voto"}
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* Transparency: every pleno member sees the per-member vote detail of
            this votación, read-only (no retirar/reingresar controls). */}
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Detalle de votos por integrante
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TopicBallotsPanel topicId={topicId} live />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
