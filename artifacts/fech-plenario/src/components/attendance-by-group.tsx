import { groupStyle, buildGroupStats, type Person } from "@/lib/groups";

export function AttendanceByGroup({
  present,
  absent,
  variant = "full",
}: {
  present: Person[];
  absent: Person[];
  variant?: "full" | "compact";
}) {
  const stats = buildGroupStats(present, absent);
  const totalPresent = present.length;

  if (stats.length === 0) {
    return <div className="text-sm text-muted-foreground">Sin miembres registrades.</div>;
  }

  const stackedBar = (
    <div className="flex h-3 w-full rounded-full overflow-hidden bg-gray-100">
      {stats.map((s) => {
        if (s.presentCount === 0 || totalPresent === 0) return null;
        const style = groupStyle(s.key);
        return (
          <div
            key={s.key}
            style={{ width: `${(s.presentCount / totalPresent) * 100}%` }}
            className={`${style.bar} transition-all duration-700 ease-out`}
          />
        );
      })}
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        {stackedBar}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {stats.map((s) => {
            const style = groupStyle(s.key);
            return (
              <span key={s.key} className="flex items-center gap-1 text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                <span className="font-medium text-foreground">{style.label}</span>
                {s.presentCount}/{s.totalCount}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stackedBar}
      <div className="space-y-3">
        {stats.map((s) => {
          const style = groupStyle(s.key);
          const pct = s.totalCount > 0 ? (s.presentCount / s.totalCount) * 100 : 0;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-2 font-medium">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                  {style.label}
                </span>
                <span className="text-muted-foreground">
                  {s.presentCount}/{s.totalCount} · <span className={style.text}>{s.presentWeight.toFixed(2)}</span>/
                  {s.totalWeight.toFixed(2)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${style.bar} transition-all duration-700 ease-out`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
