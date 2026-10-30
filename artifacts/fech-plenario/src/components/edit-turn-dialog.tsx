import { useState } from "react";
import { Pencil } from "lucide-react";
import {
  useUpdateSpeakingTurn,
  getListSpeakingTurnsQueryKey,
  type Member,
  type SpeakingTurn,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRegularSpeakers } from "@/lib/regular-speakers";

const split = (total: number) => ({ min: String(Math.floor(total / 60)), sec: String(total % 60) });
const join = (min: string, sec: string) =>
  Math.max(0, (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0));

function TimeFields({
  idPrefix,
  label,
  min,
  sec,
  onMin,
  onSec,
  disabled,
}: {
  idPrefix: string;
  label: string;
  min: string;
  sec: string;
  onMin: (v: string) => void;
  onSec: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-min`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={`${idPrefix}-min`} type="number" min={0} value={min} onChange={(e) => onMin(e.target.value)} disabled={disabled} className="w-20" />
        <span className="text-sm text-muted-foreground">min</span>
        <Input type="number" min={0} max={59} value={sec} onChange={(e) => onSec(e.target.value)} disabled={disabled} className="w-20" />
        <span className="text-sm text-muted-foreground">seg</span>
      </div>
    </div>
  );
}

export function EditTurnDialog({
  turn,
  members,
  sessionId,
}: {
  turn: SpeakingTurn;
  members: Member[];
  sessionId: number;
}) {
  const [open, setOpen] = useState(false);
  const individual = turn.kind === "individual";
  const live = !!turn.startedAt;
  const [mode, setMode] = useState<"name" | "member">(turn.userId ? "member" : "name");
  const [name, setName] = useState(turn.userId ? "" : turn.label);
  const [memberId, setMemberId] = useState(turn.userId ? String(turn.userId) : "");
  const [category, setCategory] = useState<"pleno" | "base">(turn.category);
  const used = split(turn.elapsedSeconds);
  const [usedMin, setUsedMin] = useState(used.min);
  const [usedSec, setUsedSec] = useState(used.sec);
  const assigned = split(turn.durationSeconds);
  const [durMin, setDurMin] = useState(assigned.min);
  const [durSec, setDurSec] = useState(assigned.sec);

  const updateTurn = useUpdateSpeakingTurn();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: regulars } = useRegularSpeakers(open && individual);

  const reset = () => {
    const u = split(turn.elapsedSeconds);
    const d = split(turn.durationSeconds);
    setMode(turn.userId ? "member" : "name");
    setName(turn.userId ? "" : turn.label);
    setMemberId(turn.userId ? String(turn.userId) : "");
    setCategory(turn.category);
    setUsedMin(u.min);
    setUsedSec(u.sec);
    setDurMin(d.min);
    setDurSec(d.sec);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Parameters<typeof updateTurn.mutate>[0]["data"] = {
      category,
      durationSeconds: Math.max(1, join(durMin, durSec)),
    };
    if (!live) data.elapsedSeconds = join(usedMin, usedSec);
    if (individual) {
      if (mode === "member") {
        if (!memberId) {
          toast({ title: "Selecciona une miembre", variant: "destructive" });
          return;
        }
        if (Number(memberId) !== turn.userId) data.userId = Number(memberId);
      } else {
        if (!name.trim()) {
          toast({ title: "Ingresa un nombre", variant: "destructive" });
          return;
        }
        if (turn.userId || name.trim() !== turn.label) data.speakerName = name.trim();
      }
    }
    updateTurn.mutate(
      { turnId: turn.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSpeakingTurnsQueryKey(sessionId) });
          toast({ title: "Intervención actualizada" });
          setOpen(false);
        },
        onError: () => toast({ title: "No se pudo actualizar la intervención", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Editar intervención">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar intervención</DialogTitle>
          <DialogDescription>
            Corrige quién habló, su categoría y el tiempo. {live && "El tiempo utilizado se puede editar al pausar o finalizar la palabra."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {individual ? (
            <div className="space-y-2">
              <Label>Quién intervino</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant={mode === "name" ? "default" : "outline"} onClick={() => setMode("name")}>
                  Nombre libre
                </Button>
                <Button type="button" size="sm" variant={mode === "member" ? "default" : "outline"} onClick={() => setMode("member")}>
                  Integrante
                </Button>
              </div>
              {mode === "name" ? (
                <>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de quien intervino" />
                  {(regulars ?? []).filter((r) => r.active).length > 0 && (
                    <Select value="" onValueChange={(v) => setName(v)}>
                      <SelectTrigger><SelectValue placeholder="O elegir un interviniente regular" /></SelectTrigger>
                      <SelectContent>
                        {(regulars ?? []).filter((r) => r.active).map((r) => (
                          <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </>
              ) : (
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona une integrante" /></SelectTrigger>
                  <SelectContent>
                    {[...members]
                      .sort((a, b) => a.displayName.localeCompare(b.displayName))
                      .map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>{m.displayName}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Las palabras colectivas solo permiten editar tiempos.</p>
          )}
          <div className="space-y-1">
            <Label>Categoría</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as "pleno" | "base")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pleno">Integrante del Pleno</SelectItem>
                <SelectItem value="base">Estudiante de Base</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TimeFields idPrefix={`used-${turn.id}`} label="Tiempo utilizado" min={usedMin} sec={usedSec} onMin={setUsedMin} onSec={setUsedSec} disabled={live} />
          <TimeFields idPrefix={`dur-${turn.id}`} label="Tiempo asignado" min={durMin} sec={durSec} onMin={setDurMin} onSec={setDurSec} />
          <Button type="submit" disabled={updateTurn.isPending}>Guardar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
