import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTopicBallots,
  getGetTopicBallotsQueryKey,
  getGetTopicResultsQueryKey,
  useSetMemberVote,
  type BallotMember,
  type Topic,
  type AdminBallotInput,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { canonicalGroup, groupStyle } from "@/lib/groups";

type VoteOption = "favor" | "contra" | "abstención";

const OPTIONS: { value: VoteOption; label: string; active: string }[] = [
  { value: "favor", label: "Favor", active: "bg-lime-600 text-white hover:bg-lime-600" },
  { value: "contra", label: "Contra", active: "bg-red-600 text-white hover:bg-red-600" },
  { value: "abstención", label: "Abstención", active: "bg-amber-500 text-white hover:bg-amber-500" },
];

const GROUP_RANK: Record<string, number> = {
  "Consejeros FECh": 0,
  CEE: 1,
  COSEFECH: 2,
};

function groupRank(group: string | null): number {
  return group && group in GROUP_RANK ? GROUP_RANK[group] : 99;
}

const STATUS_RANK: Record<BallotMember["status"], number> = {
  present: 0,
  checkedOut: 1,
  absent: 2,
};

function sortMembers(members: BallotMember[]): BallotMember[] {
  return [...members].sort((a, b) => {
    const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (sr !== 0) return sr;
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr !== 0) return gr;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function EditVotesDialog({
  sessionId,
  topics,
  open,
  onOpenChange,
}: {
  sessionId: number;
  topics: Topic[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setMemberVote = useSetMemberVote();
  const [search, setSearch] = useState("");
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);

  // Any votación can be edited per-member: mociones (favor/contra/abstención)
  // and candidato votaciones (single or multiple selection).
  const editableTopics = topics ?? [];
  const [topicId, setTopicId] = useState<number | null>(null);
  const selectedTopicId = topicId ?? editableTopics[0]?.id ?? null;
  const selectedTopic = useMemo(
    () => editableTopics.find((t) => t.id === selectedTopicId) ?? null,
    [editableTopics, selectedTopicId],
  );

  const isCandidato = selectedTopic?.type === "candidato";
  const isMultiple = selectedTopic?.candidateMode === "multiple";
  const candidates = selectedTopic?.candidates ?? [];
  const votesPerVoter = selectedTopic?.votesPerVoter ?? 1;

  const { data, isLoading } = useGetTopicBallots(selectedTopicId ?? 0, {
    query: {
      enabled: open && !!selectedTopicId,
      queryKey: getGetTopicBallotsQueryKey(selectedTopicId ?? 0),
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const members = (data?.members ?? []).filter(
      (m) =>
        !q ||
        m.displayName.toLowerCase().includes(q) ||
        (m.group ?? "").toLowerCase().includes(q),
    );
    return sortMembers(members);
  }, [data, search]);

  const submit = (m: BallotMember, body: AdminBallotInput) => {
    if (!selectedTopicId) return;
    setPendingUserId(m.userId);
    setMemberVote.mutate(
      { topicId: selectedTopicId, userId: m.userId, data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTopicBallotsQueryKey(selectedTopicId) });
          queryClient.invalidateQueries({ queryKey: getGetTopicResultsQueryKey(selectedTopicId) });
        },
        onError: () =>
          toast({ title: "No se pudo actualizar el voto", variant: "destructive" }),
        onSettled: () => setPendingUserId(null),
      },
    );
  };

  // --- moción helpers ---
  const currentOption = (m: BallotMember): VoteOption | null => {
    if (!m.voted || !m.voteLabel) return null;
    const v = m.voteLabel as VoteOption;
    return v === "favor" || v === "contra" || v === "abstención" ? v : null;
  };

  // --- candidato helpers ---
  // single: the one allocation's candidateId (null = abstención, undefined = sin voto)
  const singleSelection = (m: BallotMember): number | null | undefined => {
    if (!m.voted) return undefined;
    const alloc = (m.allocations ?? [])[0];
    if (!alloc) return undefined;
    return alloc.candidateId;
  };
  // multiple: the set of chosen candidate ids (abstención rows have candidateId null)
  const multiSelected = (m: BallotMember): Set<number> => {
    const s = new Set<number>();
    for (const a of m.allocations ?? []) if (a.candidateId !== null) s.add(a.candidateId);
    return s;
  };

  const setSingle = (m: BallotMember, candidateId: number | null) =>
    submit(m, { allocations: [{ candidateId, count: 1 }] });

  const toggleMulti = (m: BallotMember, candidateId: number) => {
    const next = multiSelected(m);
    if (next.has(candidateId)) {
      next.delete(candidateId);
    } else {
      if (next.size >= votesPerVoter) {
        toast({ title: `Puedes elegir hasta ${votesPerVoter} opción(es)`, variant: "destructive" });
        return;
      }
      next.add(candidateId);
    }
    submit(m, { allocations: [...next].map((id) => ({ candidateId: id, count: 1 })) });
  };

  const clearVote = (m: BallotMember) =>
    submit(m, isCandidato ? { allocations: null } : { option: null });

  const renderControls = (m: BallotMember, busy: boolean) => {
    if (!isCandidato) {
      const cur = currentOption(m);
      return (
        <>
          {OPTIONS.map((o) => (
            <Button
              key={o.value}
              size="sm"
              variant={cur === o.value ? "default" : "outline"}
              className={`h-7 px-2 text-xs ${cur === o.value ? o.active : ""}`}
              disabled={busy}
              onClick={() => submit(m, { option: o.value })}
            >
              {o.label}
            </Button>
          ))}
          {cur !== null ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => clearVote(m)}
            >
              Borrar
            </Button>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin voto</Badge>
          )}
        </>
      );
    }

    if (isMultiple) {
      const sel = multiSelected(m);
      return (
        <>
          {candidates.map((c) => {
            const on = sel.has(c.id);
            return (
              <Button
                key={c.id}
                size="sm"
                variant={on ? "default" : "outline"}
                className={`h-7 px-2 text-xs ${on ? "bg-sky-600 text-white hover:bg-sky-600" : ""}`}
                disabled={busy}
                onClick={() => toggleMulti(m, c.id)}
              >
                {c.name}
              </Button>
            );
          })}
          {m.voted ? (
            <>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {sel.size}/{votesPerVoter} · {votesPerVoter - sel.size} abst.
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={busy}
                onClick={() => clearVote(m)}
              >
                Borrar
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin voto</Badge>
          )}
        </>
      );
    }

    // candidato single
    const cur = singleSelection(m);
    return (
      <>
        {candidates.map((c) => {
          const on = cur === c.id;
          return (
            <Button
              key={c.id}
              size="sm"
              variant={on ? "default" : "outline"}
              className={`h-7 px-2 text-xs ${on ? "bg-sky-600 text-white hover:bg-sky-600" : ""}`}
              disabled={busy}
              onClick={() => setSingle(m, c.id)}
            >
              {c.name}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={cur === null ? "default" : "outline"}
          className={`h-7 px-2 text-xs ${cur === null ? "bg-amber-500 text-white hover:bg-amber-500" : ""}`}
          disabled={busy}
          onClick={() => setSingle(m, null)}
        >
          Abstención
        </Button>
        {cur !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onClick={() => clearVote(m)}
          >
            Borrar
          </Button>
        ) : (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin voto</Badge>
        )}
      </>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw]">
        <DialogHeader>
          <DialogTitle>Editar votaciones</DialogTitle>
        </DialogHeader>

        {editableTopics.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground text-center">
            No hay votaciones en esta sesión para editar.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Select
                value={selectedTopicId ? String(selectedTopicId) : ""}
                onValueChange={(v) => setTopicId(parseInt(v, 10))}
              >
                <SelectTrigger className="flex-1"><SelectValue placeholder="Elegir votación" /></SelectTrigger>
                <SelectContent>
                  {editableTopics.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                      {t.type === "candidato"
                        ? t.candidateMode === "multiple"
                          ? " · candidato (múltiple)"
                          : " · candidato"
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Buscar por nombre o grupo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:w-56"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {isCandidato && isMultiple
                ? `Marca hasta ${votesPerVoter} opción(es) por miembro; el resto cuenta como abstención. El peso se toma del valor actual del miembro.`
                : "Cambia o borra el voto de cada miembro. El peso se toma del valor actual del miembro."}
            </p>

            {isLoading ? (
              <div className="py-6 flex justify-center"><Spinner /></div>
            ) : (
              <div className="rounded-lg border divide-y max-h-[55vh] overflow-y-auto">
                {filtered.map((m) => {
                  const gs = groupStyle(canonicalGroup(m.group));
                  const busy = pendingUserId === m.userId && setMemberVote.isPending;
                  const dimmed = m.status !== "present";
                  return (
                    <div key={m.userId} className={`flex items-start gap-3 px-3 py-2 text-sm ${dimmed ? "bg-muted/30" : ""}`}>
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${gs.dot}`} />
                      <div className="min-w-0 w-40 shrink-0">
                        <div className="font-medium truncate">{m.displayName}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {gs.short} · peso {m.weight}
                          {m.status === "checkedOut" && " · retirade"}
                          {m.status === "absent" && " · ausente"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 flex-1 justify-end">
                        {renderControls(m, busy)}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">Sin miembres.</div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
