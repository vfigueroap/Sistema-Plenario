import type { AgendaPoint } from "@workspace/api-client-react";
import { Clock } from "lucide-react";

export function formatMinutes(min: number | null | undefined): string | null {
  if (min === null || min === undefined || min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function SessionAgenda({ points }: { points: AgendaPoint[] }) {
  const sorted = [...points].sort((a, b) => a.position - b.position || a.id - b.id);

  if (sorted.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No hay puntos en la tabla todavía.</div>
    );
  }

  const totalMinutes = sorted.reduce((sum, p) => sum + (p.estimatedMinutes ?? 0), 0);
  const totalLabel = formatMinutes(totalMinutes);

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {sorted.map((p, i) => {
          const t = formatMinutes(p.estimatedMinutes);
          return (
            <li key={p.id} className="flex items-start gap-3 rounded-md border bg-card p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="flex-1 font-medium leading-tight">{p.title}</span>
              {t && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                  <Clock className="h-3.5 w-3.5" />
                  {t}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {totalLabel && (
        <div className="flex justify-end text-xs text-muted-foreground">
          Tiempo estimado total: <span className="ml-1 font-medium text-foreground">{totalLabel}</span>
        </div>
      )}
    </div>
  );
}
