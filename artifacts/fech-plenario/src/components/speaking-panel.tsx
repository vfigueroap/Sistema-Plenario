import { useMemo, useState } from "react";
import {
  useListSpeakingTurns,
  useRequestSpeakingTurn,
  useCreateCollectiveSpeakingTurn,
  useReorderSpeakingTurns,
  useUpdateSpeakingTurn,
  useControlSpeakingTurn,
  useDeleteSpeakingTurn,
  useListUnidadesAcademicas,
  getListSpeakingTurnsQueryKey,
  type SpeakingTurn,
  type AgendaPoint,
  type AttendanceRecord,
  type Member,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { SpeakingTimer } from "@/components/speaking-timer";
import { Play, Pause, Square, Hand, ArrowUp, ArrowDown, Trash2, Users, Plus, Mic, Check, ChevronsUpDown } from "lucide-react";

const CONSEJEROS_GROUP = "Consejeros FECh";
const NO_POINT = "none";

const CATEGORY_LABEL: Record<string, string> = {
  pleno: "Integrante del Pleno",
  base: "Estudiante de Base",
};

function statusBadge(status: string) {
  if (status === "hablando") return <Badge className="bg-lime-600 hover:bg-lime-600">Hablando</Badge>;
  if (status === "finalizada") return <Badge variant="outline">Finalizada</Badge>;
  return <Badge variant="secondary">En cola</Badge>;
}

function pointLabel(agenda: AgendaPoint[], id: number | null | undefined): string {
  if (id === null || id === undefined) return "Sin punto asignado";
  const p = agenda.find((a) => a.id === id);
  return p ? p.title : "Sin punto asignado";
}

export function SpeakingPanel({
  sessionId,
  agenda,
  isAdmin,
  members = [],
  presentRecords = [],
  currentUserId,
  speakingRoundOpen = false,
  speakingRoundAgendaPointId = null,
}: {
  sessionId: number;
  agenda: AgendaPoint[];
  isAdmin: boolean;
  members?: Member[];
  presentRecords?: AttendanceRecord[];
  currentUserId?: number;
  speakingRoundOpen?: boolean;
  speakingRoundAgendaPointId?: number | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: turns } = useListSpeakingTurns(sessionId, {
    query: {
      enabled: !!sessionId,
      // Realtime `speaking:changed` drives instant updates; this poll is only a
      // fallback for when the socket is down (relaxed from 5s to cut load at scale).
      refetchInterval: 30000,
      queryKey: getListSpeakingTurnsQueryKey(sessionId),
    },
  });

  const requestTurn = useRequestSpeakingTurn();
  const createCollective = useCreateCollectiveSpeakingTurn();
  const reorderTurns = useReorderSpeakingTurns();
  const updateTurn = useUpdateSpeakingTurn();
  const controlTurn = useControlSpeakingTurn();
  const deleteTurn = useDeleteSpeakingTurn();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSpeakingTurnsQueryKey(sessionId) });

  // Member self-request form
  const [reqCategory, setReqCategory] = useState<"pleno" | "base">("pleno");

  // Admin add-individual form
  const [addMode, setAddMode] = useState<"member" | "name">("member");
  const [addMemberId, setAddMemberId] = useState<string>("");
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState<"pleno" | "base">("pleno");
  const [addPoint, setAddPoint] = useState<string>(NO_POINT);
  const [addSeconds, setAddSeconds] = useState("60");

  // Admin collective form
  const [collFaculty, setCollFaculty] = useState<string>("");
  const [collPoint, setCollPoint] = useState<string>(NO_POINT);

  const sortedTurns = useMemo(
    () => [...(turns ?? [])].sort((a, b) => a.position - b.position || a.id - b.id),
    [turns],
  );

  const activeTurns = sortedTurns.filter((t) => t.status !== "finalizada");
  const finishedTurns = sortedTurns.filter((t) => t.status === "finalizada");

  // Queues are scoped per agenda point: each point has its own ordered list.
  const groups = useMemo(() => {
    const byPoint = new Map<string, SpeakingTurn[]>();
    for (const t of activeTurns) {
      const key = t.agendaPointId == null ? NO_POINT : String(t.agendaPointId);
      const arr = byPoint.get(key) ?? [];
      arr.push(t);
      byPoint.set(key, arr);
    }
    const sortGroup = (arr: SpeakingTurn[]) =>
      [...arr].sort((a, b) => a.position - b.position || a.id - b.id);
    const ordered: { key: string; label: string; turns: SpeakingTurn[] }[] = [];
    for (const p of agenda) {
      const key = String(p.id);
      const arr = byPoint.get(key);
      if (arr) ordered.push({ key, label: p.title, turns: sortGroup(arr) });
    }
    const none = byPoint.get(NO_POINT);
    if (none) ordered.push({ key: NO_POINT, label: "Sin punto asignado", turns: sortGroup(none) });
    return ordered;
  }, [activeTurns, agenda]);

  const myTurns = currentUserId
    ? activeTurns.filter((t) => t.userId === currentUserId)
    : [];

  // Managed catalog of unidades académicas (feature: CRUD from members section).
  const { data: unidades } = useListUnidadesAcademicas();

  // Collective word picker: list the managed unidades, annotated with how many
  // consejeres belong to each (whole group, not just present).
  const consejeroFaculties = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      if (m.group === CONSEJEROS_GROUP && m.faculty) {
        counts.set(m.faculty, (counts.get(m.faculty) ?? 0) + 1);
      }
    }
    return (unidades ?? [])
      .map((u) => [u.name, counts.get(u.name) ?? 0] as [string, number])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [members, unidades]);

  const parsePoint = (v: string): number | null => (v === NO_POINT ? null : Number(v));

  const handleSelfRequest = () => {
    // The round is scoped to a single agenda point; the server files the request
    // under that point regardless, so we send it for clarity.
    requestTurn.mutate(
      { id: sessionId, data: { category: reqCategory, agendaPointId: speakingRoundAgendaPointId ?? null } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Pediste la palabra" });
        },
        onError: () =>
          toast({ title: "No se pudo pedir la palabra", variant: "destructive" }),
      },
    );
  };

  const handleAddIndividual = () => {
    const data: Parameters<typeof requestTurn.mutate>[0]["data"] = {
      category: addCategory,
      agendaPointId: parsePoint(addPoint),
      durationSeconds: Math.max(1, parseInt(addSeconds, 10) || 60),
    };
    if (addMode === "member" && addCategory === "pleno") {
      if (!addMemberId) {
        toast({ title: "Selecciona une miembre", variant: "destructive" });
        return;
      }
      data.userId = Number(addMemberId);
    } else {
      if (!addName.trim()) {
        toast({ title: "Ingresa un nombre", variant: "destructive" });
        return;
      }
      data.speakerName = addName.trim();
    }
    requestTurn.mutate(
      { id: sessionId, data },
      {
        onSuccess: () => {
          invalidate();
          setAddName("");
          setAddMemberId("");
          toast({ title: "Oradore agregade a la cola" });
        },
        onError: () => toast({ title: "No se pudo agregar", variant: "destructive" }),
      },
    );
  };

  const handleCollective = () => {
    if (!collFaculty) {
      toast({ title: "Selecciona una Unidad Académica", variant: "destructive" });
      return;
    }
    createCollective.mutate(
      { id: sessionId, data: { faculty: collFaculty, agendaPointId: parsePoint(collPoint) } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Palabra colectiva creada" });
        },
        onError: () =>
          toast({ title: "No hay consejeres de esa unidad", variant: "destructive" }),
      },
    );
  };

  const control = (turnId: number, action: "grant" | "start" | "pause" | "finish") => {
    controlTurn.mutate({ turnId, data: { action } }, { onSuccess: invalidate });
  };

  const adjustSeconds = (turn: SpeakingTurn, delta: number) => {
    const next = Math.max(1, turn.durationSeconds + delta);
    updateTurn.mutate({ turnId: turn.id, data: { durationSeconds: next } }, { onSuccess: invalidate });
  };

  const move = (groupTurns: SpeakingTurn[], index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= groupTurns.length) return;
    const ids = groupTurns.map((t) => t.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderTurns.mutate({ id: sessionId, data: { orderedIds: ids } }, { onSuccess: invalidate });
  };

  const remove = (turnId: number) => {
    deleteTurn.mutate({ turnId }, { onSuccess: invalidate });
  };

  const renderTurnRow = (turn: SpeakingTurn, index: number, groupTurns: SpeakingTurn[]) => {
    const isLive = !!turn.startedAt;
    return (
      <div
        key={turn.id}
        className={`rounded-md border p-3 ${turn.status === "hablando" ? "border-lime-500 bg-lime-50/50" : "bg-card"}`}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium leading-tight">{turn.label}</span>
              {turn.kind === "colectiva" && (
                <Badge variant="outline" className="gap-1">
                  <Users className="h-3 w-3" />
                  {turn.participants.length}
                </Badge>
              )}
              {statusBadge(turn.status)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {CATEGORY_LABEL[turn.category] ?? turn.category}
              {turn.kind === "colectiva" && turn.faculty ? ` · ${turn.faculty}` : ""}
            </div>
            {turn.kind === "colectiva" && turn.participants.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {turn.participants.map((p) => p.displayName).join(", ")}
              </div>
            )}
          </div>
          <div className="text-right">
            <SpeakingTimer turn={turn} className="text-lg" />
            <div className="text-[10px] text-muted-foreground">
              de {Math.floor(turn.durationSeconds / 60)}:
              {(turn.durationSeconds % 60).toString().padStart(2, "0")}
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2">
            {turn.status !== "hablando" && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => control(turn.id, "grant")}>
                <Hand className="h-3.5 w-3.5 mr-1" /> Otorgar
              </Button>
            )}
            {isLive ? (
              <Button size="sm" variant="outline" className="h-7" onClick={() => control(turn.id, "pause")}>
                <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
              </Button>
            ) : (
              <Button size="sm" className="h-7 bg-lime-600 hover:bg-lime-700" onClick={() => control(turn.id, "start")}>
                <Play className="h-3.5 w-3.5 mr-1" /> Iniciar
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7" onClick={() => control(turn.id, "finish")}>
              <Square className="h-3.5 w-3.5 mr-1" /> Finalizar
            </Button>
            <div className="flex items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => adjustSeconds(turn, -30)}>
                −30s
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => adjustSeconds(turn, 30)}>
                +30s
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(groupTurns, index, -1)} disabled={index === 0}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(groupTurns, index, 1)} disabled={index === groupTurns.length - 1}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600 hover:text-red-700" onClick={() => remove(turn.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Member self-request */}
      {!isAdmin && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Hand className="h-4 w-4" /> Pedir la palabra
          </div>
          {!speakingRoundOpen && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              La ronda de palabras está cerrada. Podrás pedir la palabra cuando la mesa la abra.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoría</Label>
              <Select value={reqCategory} onValueChange={(v) => setReqCategory(v as "pleno" | "base")} disabled={!speakingRoundOpen}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pleno">Integrante del Pleno</SelectItem>
                  <SelectItem value="base">Estudiante de Base</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Punto de la tabla</Label>
              <div className="flex h-9 items-center rounded-md border bg-background px-3 text-sm text-muted-foreground">
                {speakingRoundOpen ? pointLabel(agenda, speakingRoundAgendaPointId) : "—"}
              </div>
            </div>
          </div>
          <Button onClick={handleSelfRequest} disabled={requestTurn.isPending || !speakingRoundOpen} className="w-full sm:w-auto">
            <Hand className="h-4 w-4 mr-2" /> Pedir la palabra
          </Button>
          {myTurns.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Estás en la cola
              {myTurns.map((t) => {
                const g = groups.find((gr) => gr.turns.some((x) => x.id === t.id));
                const pos = g ? g.turns.findIndex((x) => x.id === t.id) + 1 : 0;
                return ` · #${pos} (${pointLabel(agenda, t.agendaPointId)})`;
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin add controls */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <Mic className="h-4 w-4" /> Agregar oradore
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={addCategory}
                onValueChange={(v) => {
                  const c = v as "pleno" | "base";
                  setAddCategory(c);
                  // Base students aren't registered members, so force free-name entry.
                  if (c === "base") {
                    setAddMode("name");
                    setAddMemberId("");
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pleno">Integrante del Pleno</SelectItem>
                  <SelectItem value="base">Estudiante de Base</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" min={1} value={addSeconds} onChange={(e) => setAddSeconds(e.target.value)} placeholder="Segundos" />
            </div>
            {addCategory === "pleno" && (
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={addMode === "member" ? "default" : "outline"} size="sm" onClick={() => setAddMode("member")}>
                  Miembre
                </Button>
                <Button type="button" variant={addMode === "name" ? "default" : "outline"} size="sm" onClick={() => setAddMode("name")}>
                  Nombre libre
                </Button>
              </div>
            )}
            {addCategory === "pleno" && addMode === "member" ? (
              <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={memberPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={cn("truncate", !addMemberId && "text-muted-foreground")}>
                      {addMemberId
                        ? members.find((m) => String(m.id) === addMemberId)?.displayName ?? "Selecciona miembre"
                        : "Buscar miembre..."}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Escribe un nombre..." />
                    <CommandList>
                      <CommandEmpty>No se encontraron miembres.</CommandEmpty>
                      <CommandGroup>
                        {[...members]
                          .sort((a, b) => a.displayName.localeCompare(b.displayName))
                          .map((m) => (
                            <CommandItem
                              key={m.id}
                              value={m.displayName}
                              onSelect={() => {
                                setAddMemberId(String(m.id) === addMemberId ? "" : String(m.id));
                                setMemberPickerOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", addMemberId === String(m.id) ? "opacity-100" : "opacity-0")} />
                              {m.displayName}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Input placeholder="Nombre del oradore" value={addName} onChange={(e) => setAddName(e.target.value)} />
            )}
            <Select value={addPoint} onValueChange={setAddPoint}>
              <SelectTrigger><SelectValue placeholder="Sin punto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_POINT}>Sin punto asignado</SelectItem>
                {agenda.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAddIndividual} disabled={requestTurn.isPending} className="w-full">
              <Plus className="h-4 w-4 mr-2" /> Agregar a la cola
            </Button>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Palabra colectiva (Consejeres)
            </div>
            <p className="text-xs text-muted-foreground">
              Agrupa a todo el grupo de consejeres de una misma Unidad Académica en un solo temporizador (3 minutos por defecto).
            </p>
            <Select value={collFaculty} onValueChange={setCollFaculty}>
              <SelectTrigger><SelectValue placeholder="Unidad Académica" /></SelectTrigger>
              <SelectContent>
                {consejeroFaculties.length === 0 ? (
                  <SelectItem value="__none" disabled>No hay consejeres</SelectItem>
                ) : (
                  consejeroFaculties.map(([fac, count]) => (
                    <SelectItem key={fac} value={fac}>{fac} ({count})</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Select value={collPoint} onValueChange={setCollPoint}>
              <SelectTrigger><SelectValue placeholder="Sin punto" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_POINT}>Sin punto asignado</SelectItem>
                {agenda.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleCollective} disabled={createCollective.isPending || !collFaculty} className="w-full">
              <Users className="h-4 w-4 mr-2" /> Armar palabra colectiva
            </Button>
          </div>
        </div>
      )}

      {/* Active queue, grouped by agenda point */}
      <div className="space-y-4">
        {groups.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg border-dashed">
            No hay oradores en la cola.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-normal">{group.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {group.turns.length} {group.turns.length === 1 ? "oradore" : "oradores"}
                </span>
              </div>
              {group.turns.map((turn, i) => renderTurnRow(turn, i, group.turns))}
            </div>
          ))
        )}
      </div>

      {/* Finished */}
      {finishedTurns.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Finalizadas ({finishedTurns.length})</div>
          {finishedTurns.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Square className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate">{t.label}</span>
              <span className="text-xs">{pointLabel(agenda, t.agendaPointId)}</span>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600" onClick={() => remove(t.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
