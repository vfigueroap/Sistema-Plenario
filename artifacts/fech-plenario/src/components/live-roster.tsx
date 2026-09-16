import type { AttendanceRecord } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { groupStyle, canonicalGroup } from "@/lib/groups";
import { Wifi, MapPin, LogOut } from "lucide-react";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

export function LiveRoster({
  present,
  checkedOut,
}: {
  present: AttendanceRecord[];
  checkedOut: AttendanceRecord[];
}) {
  const sortedPresent = [...present].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const sortedOut = [...checkedOut].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Presentes</span>
          <Badge variant="secondary">{sortedPresent.length}</Badge>
        </div>
        {sortedPresent.length === 0 ? (
          <div className="text-sm text-muted-foreground">Aún no hay asistentes activos.</div>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {sortedPresent.map((p) => {
              const style = groupStyle(canonicalGroup(p.group));
              return (
                <li key={p.userId} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                  <span className="flex-1 truncate">{p.displayName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {p.modality === "online" ? (
                      <Wifi className="h-3.5 w-3.5" />
                    ) : (
                      <MapPin className="h-3.5 w-3.5" />
                    )}
                    {timeLabel(p.timestamp)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {sortedOut.length > 0 && (
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Retirados</span>
            <Badge variant="outline">{sortedOut.length}</Badge>
          </div>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {sortedOut.map((p) => (
              <li
                key={p.userId}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate line-through">{p.displayName}</span>
                {p.checkedOutAt && (
                  <span className="text-xs">se retiró {timeLabel(p.checkedOutAt)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
