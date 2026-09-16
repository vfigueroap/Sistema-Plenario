import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTopicBallots,
  getGetTopicBallotsQueryKey,
  useAdminCheckoutMember,
  useAdminReactivateMember,
  getListAttendanceQueryKey,
  type BallotMember,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { canonicalGroup, groupStyle } from "@/lib/groups";
import { CheckCircle2, LogOut, LogIn, MinusCircle } from "lucide-react";

// Order estamentos Consejeros → CEE → COSEFECH, then everyone else.
const GROUP_RANK: Record<string, number> = {
  "Consejeros FECh": 0,
  CEE: 1,
  COSEFECH: 2,
};

function groupRank(group: string | null): number {
  if (group && group in GROUP_RANK) return GROUP_RANK[group];
  return 99;
}

// present first, then retired (checkedOut), then absent — always at the bottom.
const STATUS_RANK: Record<BallotMember["status"], number> = {
  present: 0,
  checkedOut: 1,
  absent: 2,
};

type SortMode = "grupo" | "nombre" | "voto";

function sortBallots(members: BallotMember[], mode: SortMode): BallotMember[] {
  return [...members].sort((a, b) => {
    // Absent + retired always sink to the bottom regardless of sort mode.
    const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (sr !== 0) return sr;
    if (mode === "nombre") return a.displayName.localeCompare(b.displayName);
    if (mode === "voto") {
      const vr = Number(b.voted) - Number(a.voted);
      if (vr !== 0) return vr;
      return a.displayName.localeCompare(b.displayName);
    }
    // "grupo": Consejeros → CEE → COSEFECH → otros, then by name.
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr !== 0) return gr;
    return a.displayName.localeCompare(b.displayName);
  });
}

function StatusPill({ m }: { m: BallotMember }) {
  if (m.status === "absent")
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Ausente</Badge>;
  if (m.status === "checkedOut")
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">Retirade</Badge>;
  if (m.voted)
    return (
      <span className="inline-flex items-center gap-1 text-lime-600 text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" /> Votó
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
      <MinusCircle className="h-3.5 w-3.5" /> No votó
    </span>
  );
}

export function TopicBallotsPanel({
  topicId,
  sessionId,
  allowCheckout = false,
  live = false,
  enabled = true,
}: {
  topicId: number;
  sessionId?: number;
  allowCheckout?: boolean;
  live?: boolean;
  enabled?: boolean;
}) {
  const [sortMode, setSortMode] = useState<SortMode>("grupo");
  const realtime = useRealtimeStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const checkout = useAdminCheckoutMember();
  const reactivate = useAdminReactivateMember();

  const { data, isLoading } = useGetTopicBallots(topicId, {
    query: {
      enabled: enabled && !!topicId,
      // Realtime drives instant updates while the socket is connected; the 30s
      // poll is only the fallback when it is not (avoids ~200 clients polling
      // needlessly while push updates already cover them).
      refetchInterval: live && realtime === "connected" ? false : 30000,
      queryKey: getGetTopicBallotsQueryKey(topicId),
    },
  });

  const sorted = useMemo(() => sortBallots(data?.members ?? [], sortMode), [data, sortMode]);

  const votedCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.voted).length,
    [data],
  );
  const presentCount = useMemo(
    () => (data?.members ?? []).filter((m) => m.status === "present").length,
    [data],
  );

  const handleCheckout = (userId: number, name: string) => {
    if (!sessionId) return;
    if (!confirm(`¿Retirar a ${name} de la sesión? Dejará de contar para el quórum y no podrá votar.`)) return;
    checkout.mutate(
      { id: sessionId, userId },
      {
        onSuccess: () => {
          toast({ title: `${name} fue retirade de la sesión` });
          queryClient.invalidateQueries({ queryKey: getGetTopicBallotsQueryKey(topicId) });
          queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) });
        },
        onError: () => toast({ title: "No se pudo retirar al miembre", variant: "destructive" }),
      },
    );
  };

  const handleReactivate = (userId: number, name: string) => {
    if (!sessionId) return;
    reactivate.mutate(
      { id: sessionId, userId },
      {
        onSuccess: () => {
          toast({ title: `${name} reingresó a la sesión` });
          queryClient.invalidateQueries({ queryKey: getGetTopicBallotsQueryKey(topicId) });
          queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) });
        },
        onError: () => toast({ title: "No se pudo reingresar al miembre", variant: "destructive" }),
      },
    );
  };

  if (isLoading) return <div className="py-6 flex justify-center"><Spinner /></div>;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          Votaron <span className="font-semibold text-foreground">{votedCount}</span> de{" "}
          <span className="font-semibold text-foreground">{presentCount}</span> presentes
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">Ordenar:</span>
          {(["grupo", "nombre", "voto"] as SortMode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={sortMode === m ? "default" : "outline"}
              className="h-7 px-2 text-xs capitalize"
              onClick={() => setSortMode(m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border divide-y max-h-96 overflow-y-auto">
        {sorted.map((m) => {
          const dimmed = m.status !== "present";
          const gs = groupStyle(canonicalGroup(m.group));
          return (
            <div
              key={m.userId}
              className={`flex items-center gap-3 px-3 py-2 text-sm ${dimmed ? "bg-muted/30" : ""}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${gs.dot}`} />
              <div className="min-w-0 flex-1">
                <div className={`font-medium truncate ${dimmed ? "text-muted-foreground line-through" : ""}`}>
                  {m.displayName}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {m.faculty ? `${m.faculty} · ` : ""}{gs.short} · peso {m.weight}
                </div>
              </div>
              {m.voteLabel && m.status === "present" && (
                <span className="text-xs font-medium text-foreground max-w-[8rem] truncate">{m.voteLabel}</span>
              )}
              <StatusPill m={m} />
              {allowCheckout && m.status === "present" && sessionId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                  disabled={checkout.isPending}
                  onClick={() => handleCheckout(m.userId, m.displayName)}
                >
                  <LogOut className="h-3.5 w-3.5 mr-1" /> Retirar
                </Button>
              )}
              {allowCheckout && m.status === "checkedOut" && sessionId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-lime-700 hover:text-lime-800"
                  disabled={reactivate.isPending}
                  onClick={() => handleReactivate(m.userId, m.displayName)}
                >
                  <LogIn className="h-3.5 w-3.5 mr-1" /> Reingresar
                </Button>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">Sin miembres.</div>
        )}
      </div>
    </div>
  );
}
