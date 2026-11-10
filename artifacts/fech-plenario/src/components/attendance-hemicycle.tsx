import { buildGroupStats, groupStyle, type Person } from "@/lib/groups";

type Seat = { x: number; y: number; ang: number; r: number };

function layout(total: number, rows: number, rIn: number, rOut: number, cx: number, cy: number) {
  const dr = rows > 1 ? (rOut - rIn) / (rows - 1) : 0;
  const radii = Array.from({ length: rows }, (_, i) => rIn + dr * i);
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((total * r) / sum)));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  for (let i = counts.length - 1; diff !== 0; i = (i - 1 + counts.length) % counts.length) {
    const step = diff > 0 ? 1 : -1;
    if (counts[i] + step >= 1) {
      counts[i] += step;
      diff -= step;
    }
  }
  const seats: Seat[] = [];
  radii.forEach((r, i) => {
    const c = counts[i];
    for (let k = 0; k < c; k++) {
      const ang = c === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (c - 1);
      seats.push({ x: cx + r * Math.cos(ang), y: cy - r * Math.sin(ang), ang, r });
    }
  });
  seats.sort((a, b) => b.ang - a.ang || a.r - b.r);
  const spacing = Math.PI * radii[0] / Math.max(counts[0] - 1, 1);
  const seatR = 0.4 * Math.min(dr || spacing, spacing);
  return { seats, seatR };
}

export function AttendanceHemicycle({
  present,
  absent,
  grande = false,
}: {
  present: Person[];
  absent: Person[];
  grande?: boolean;
}) {
  const stats = buildGroupStats(present, absent);
  const total = stats.reduce((s, g) => s + g.totalCount, 0);
  if (total === 0) return <div className="text-sm text-muted-foreground">Sin miembres registrades.</div>;

  const rows = total <= 30 ? 3 : total <= 60 ? 4 : total <= 90 ? 5 : 6;
  const W = 400;
  const pad = 14;
  const rOut = W / 2 - pad;
  const rIn = rOut * 0.46;
  const cx = W / 2;
  const cy = rOut + pad;
  const { seats, seatR } = layout(total, rows, rIn, rOut, cx, cy);

  let cursor = 0;
  const items: { seat: Seat; hex: string; filled: boolean }[] = [];
  for (const g of stats) {
    const hex = groupStyle(g.key).hex;
    for (let i = 0; i < g.totalCount; i++) {
      items.push({ seat: seats[cursor++], hex, filled: i < g.presentCount });
    }
  }

  const presentes = present.length;
  const pct = total > 0 ? Math.round((presentes / total) * 100) : 0;

  return (
    <figure className="m-0 flex w-full flex-col items-center">
      <svg
        viewBox={`0 0 ${W} ${cy + pad}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Asistencia por estamento: ${presentes} de ${total} personas presentes, ${pct} por ciento.`}
      >
        {items.map(({ seat, hex, filled }, i) => (
          <circle
            key={i}
            cx={seat.x}
            cy={seat.y}
            r={seatR}
            fill={filled ? hex : "#FFFFFF"}
            stroke={hex}
            strokeWidth={filled ? 0 : 1.4}
            strokeOpacity={filled ? 1 : 0.55}
            style={{ transition: "fill 500ms ease, stroke-opacity 500ms ease" }}
          />
        ))}
        <text x={cx} y={cy - rIn * 0.3} textAnchor="middle" fontSize={rIn * 0.62} fontWeight="800" fill="#111827" fontFamily="inherit">
          {presentes}
        </text>
        <text x={cx} y={cy - rIn * 0.04} textAnchor="middle" fontSize={rIn * 0.19} fill="#6B7280" fontFamily="inherit">
          de {total} presentes
        </text>
      </svg>

      <figcaption className={`mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1.5 ${grande ? "text-lg" : "text-xs"}`}>
        {stats.map((g) => {
          const style = groupStyle(g.key);
          return (
            <span key={g.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: style.hex }} />
              <span className="font-medium">{style.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {g.presentCount}/{g.totalCount}
              </span>
            </span>
          );
        })}
      </figcaption>
      <div className={`mt-1 text-muted-foreground ${grande ? "text-base" : "text-[11px]"}`}>
        Cada punto es una persona. Relleno, presente. Hueco, ausente.
      </div>
    </figure>
  );
}
