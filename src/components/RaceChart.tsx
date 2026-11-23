import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRow } from "../lib/chart";
import { fmtPct } from "../lib/format";
import type { Person } from "../lib/types";

export function RaceChart({ rows, people }: { rows: ChartRow[]; people: Person[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          domain={[(min: number) => Math.min(min, 0), (max: number) => Math.max(max, 0)]}
          tickFormatter={(v: number) => `${Number(v.toFixed(1))}%`}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ReferenceLine
          y={0}
          stroke="var(--muted)"
          strokeDasharray="6 4"
          label={{ value: "did nothing", position: "insideBottomRight", fill: "var(--muted)", fontSize: 12 }}
        />
        <Tooltip
          formatter={(v) => fmtPct(typeof v === "number" ? v : null)}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
        />
        <Legend />
        {people.map((p) => (
          <Line key={p.id} name={p.displayName} dataKey={p.id} stroke={p.color} dot={false} strokeWidth={3} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
