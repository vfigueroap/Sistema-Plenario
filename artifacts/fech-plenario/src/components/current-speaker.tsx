import { useEffect, useMemo, useState } from "react";
import {
  useListSpeakingTurns,
  getListSpeakingTurnsQueryKey,
  type SpeakingTurn,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { computeRemaining } from "@/components/speaking-timer";
import { Mic, Megaphone, Hand, Radio } from "lucide-react";

function formatClock(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

function isMine(turn: SpeakingTurn, currentUserId?: number): boolean {
  if (!currentUserId) return false;
  if (turn.userId === currentUserId) return true;
  return turn.participants?.some((p) => p.userId === currentUserId) ?? false;
}

/**
 * Global "Vista de Sesión": shows who currently holds the floor with a
 * synced countdown, visible to every attendee. When the current user is the
 * active speaker (or part of a collective turn) it switches to a prominent
 * "Tienes la palabra" banner.
 *
 * `live` indicates whether realtime sync is connected; when false the card
 * shows that updates fall back to polling.
 */
export function CurrentSpeaker({
  sessionId,
  currentUserId,
  live = false,
}: {
  sessionId: number;
  currentUserId?: number;
  live?: boolean;
}) {
  const { data: turns } = useListSpeakingTurns(sessionId, {
    query: {
      enabled: !!sessionId,
      refetchInterval: 30000,
      queryKey: getListSpeakingTurnsQueryKey(sessionId),
    },
  });

  const current = useMemo(
    () => (turns ?? []).find((t) => t.status === "hablando") ?? null,
    [turns],
  );

  const isRunning = !!current?.startedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isRunning]);

  if (!current) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5 flex items-center gap-3 text-muted-foreground">
          <Mic className="h-5 w-5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium text-foreground">Nadie tiene la palabra</div>
            <div>El presidente de la mesa aún no concede el uso de la palabra.</div>
          </div>
          <LiveDot live={live} className="ml-auto" />
        </CardContent>
      </Card>
    );
  }

  const remaining = computeRemaining(current, now);
  const overtime = remaining < 0;
  const mine = isMine(current, currentUserId);
  const collective = current.kind === "colectiva";

  const clockColor = overtime
    ? "text-red-600"
    : isRunning
      ? mine
        ? "text-white"
        : "text-lime-600"
      : "text-amber-600";

  if (mine) {
    return (
      <Card className="border-none text-white bg-gradient-to-br from-lime-600 via-emerald-600 to-teal-600 shadow-lg">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="rounded-full bg-white/20 p-3 shrink-0">
            <Megaphone className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-tight">Tienes la palabra</div>
            <div className="opacity-90 text-sm">
              {collective
                ? `Palabra colectiva · ${current.faculty ?? ""}`.trim()
                : "Es tu turno para intervenir ante el pleno."}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className={`font-mono font-bold tabular-nums text-3xl ${overtime ? "text-red-100" : "text-white"}`}>
              {formatClock(remaining)}
            </div>
            <div className="text-xs opacity-80">{overtime ? "Tiempo excedido" : "restante"}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="rounded-full bg-lime-100 p-3 shrink-0">
          {collective ? <Hand className="h-6 w-6 text-lime-700" /> : <Mic className="h-6 w-6 text-lime-700" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">En el uso de la palabra</span>
            {collective && <Badge variant="secondary">Colectiva</Badge>}
          </div>
          <div className="text-xl font-semibold leading-tight truncate">{current.label}</div>
          {collective && current.participants && current.participants.length > 0 && (
            <div className="text-sm text-muted-foreground truncate">
              {current.participants.map((p) => p.displayName).join(", ")}
            </div>
          )}
        </div>
        <div className="ml-auto text-right flex flex-col items-end gap-1">
          <div className={`font-mono font-bold tabular-nums text-3xl ${clockColor}`}>
            {formatClock(remaining)}
          </div>
          <div className="text-xs text-muted-foreground">
            {overtime ? "Tiempo excedido" : isRunning ? "restante" : "en pausa"}
          </div>
        </div>
        <LiveDot live={live} />
      </CardContent>
    </Card>
  );
}

function LiveDot({ live, className = "" }: { live: boolean; className?: string }) {
  return (
    <span
      className={`flex items-center gap-1 text-xs ${live ? "text-lime-600" : "text-muted-foreground"} ${className}`}
      title={live ? "Sincronización en vivo activa" : "Sin conexión en vivo — actualizando por sondeo"}
    >
      <Radio className={`h-3.5 w-3.5 ${live ? "animate-pulse" : ""}`} />
      {live ? "En vivo" : "Sondeo"}
    </span>
  );
}
