export type GroupStyle = {
  label: string;
  short: string;
  bar: string;
  dot: string;
  text: string;
  hex: string;
};

const FALLBACK: GroupStyle = {
  label: "Otros",
  short: "Otros",
  bar: "bg-gray-400",
  dot: "bg-gray-400",
  text: "text-gray-600",
  hex: "#9ca3af",
};

export const GROUP_ORDER = ["CEE", "Consejeros FECh", "COSEFECH", "Mesa Directiva FECh"];

export const GROUP_STYLES: Record<string, GroupStyle> = {
  CEE: { label: "CEE", short: "CEE", bar: "bg-sky-500", dot: "bg-sky-500", text: "text-sky-600", hex: "#0ea5e9" },
  "Consejeros FECh": { label: "Consejeres FECh", short: "Consejeres", bar: "bg-lime-500", dot: "bg-lime-500", text: "text-lime-600", hex: "#84cc16" },
  COSEFECH: { label: "COSEFECH", short: "COSEFECH", bar: "bg-violet-500", dot: "bg-violet-500", text: "text-violet-600", hex: "#8b5cf6" },
  "Mesa Directiva FECh": { label: "Mesa Directiva", short: "Mesa", bar: "bg-amber-500", dot: "bg-amber-500", text: "text-amber-600", hex: "#f59e0b" },
};

export function groupStyle(key: string): GroupStyle {
  return GROUP_STYLES[key] ?? FALLBACK;
}

export function groupOrderIndex(key: string): number {
  const idx = GROUP_ORDER.indexOf(key);
  return idx === -1 ? GROUP_ORDER.length : idx;
}

export function canonicalGroup(group: string | null): string {
  return group && GROUP_STYLES[group] ? group : "Otros";
}

export type Person = { group: string | null; votingWeight: number };

export type GroupStat = {
  key: string;
  presentCount: number;
  totalCount: number;
  presentWeight: number;
  totalWeight: number;
};

export function buildGroupStats(present: Person[], absent: Person[]): GroupStat[] {
  const map = new Map<string, GroupStat>();

  const ensure = (key: string) => {
    let stat = map.get(key);
    if (!stat) {
      stat = { key, presentCount: 0, totalCount: 0, presentWeight: 0, totalWeight: 0 };
      map.set(key, stat);
    }
    return stat;
  };

  for (const p of present) {
    const stat = ensure(canonicalGroup(p.group));
    stat.presentCount += 1;
    stat.totalCount += 1;
    stat.presentWeight += p.votingWeight;
    stat.totalWeight += p.votingWeight;
  }
  for (const a of absent) {
    const stat = ensure(canonicalGroup(a.group));
    stat.totalCount += 1;
    stat.totalWeight += a.votingWeight;
  }

  return Array.from(map.values()).sort(
    (a, b) => groupOrderIndex(a.key) - groupOrderIndex(b.key) || a.key.localeCompare(b.key),
  );
}
