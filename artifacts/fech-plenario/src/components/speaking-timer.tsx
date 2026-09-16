import { useEffect, useState } from "react";
import type { SpeakingTurn } from "@workspace/api-client-react";

export function computeRemaining(turn: SpeakingTurn, nowMs: number): number {
  const running = turn.startedAt
    ? Math.floor((nowMs - Date.parse(turn.startedAt)) / 1000)
    : 0;
  const elapsed = turn.elapsedSeconds + running;
  return turn.durationSeconds - elapsed;
}

function format(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

export function SpeakingTimer({ turn, className = "" }: { turn: SpeakingTurn; className?: string }) {
  const isLive = !!turn.startedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [isLive]);

  const remaining = computeRemaining(turn, now);
  const overtime = remaining < 0;
  const color = overtime
    ? "text-red-600"
    : turn.status === "hablando"
      ? isLive
        ? "text-lime-600"
        : "text-amber-600"
      : "text-muted-foreground";

  return (
    <span className={`font-mono font-semibold tabular-nums ${color} ${className}`}>
      {format(remaining)}
    </span>
  );
}
