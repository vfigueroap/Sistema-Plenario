import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { buildGroupStats, groupStyle, type Person } from "@/lib/groups";

type Datum = {
  name: string;
  label: string;
  presentes: number;
  ausentes: number;
  total: number;
  hex: string;
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Datum }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-semibold mb-1">{d.label}</div>
      <div className="text-muted-foreground">
        Presentes: <span className="font-medium text-foreground">{d.presentes}</span> / {d.total}
      </div>
    </div>
  );
}

export function AttendanceBarChart({
  present,
  absent,
  height = 220,
}: {
  present: Person[];
  absent: Person[];
  height?: number;
}) {
  const stats = buildGroupStats(present, absent);

  if (stats.length === 0) {
    return <div className="text-sm text-muted-foreground">Sin miembres registrades.</div>;
  }

  const data: Datum[] = stats.map((s) => {
    const style = groupStyle(s.key);
    return {
      name: style.short,
      label: style.label,
      presentes: s.presentCount,
      ausentes: s.totalCount - s.presentCount,
      total: s.totalCount,
      hex: style.hex,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} interval={0} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={28} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={<ChartTooltip />} />
        <Bar dataKey="presentes" stackId="a" maxBarSize={64} isAnimationActive>
          {data.map((d) => (
            <Cell key={d.name} fill={d.hex} />
          ))}
        </Bar>
        <Bar dataKey="ausentes" stackId="a" fill="#e5e7eb" maxBarSize={64} radius={[4, 4, 0, 0]} isAnimationActive />
      </BarChart>
    </ResponsiveContainer>
  );
}
