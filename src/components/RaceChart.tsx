import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRow } from "../lib/chart";
import { fmtPct } from "../lib/format";
import type { Person } from "../lib/types";

export function RaceChart({ rows, people }: { rows: ChartRow[]; people: Person[] }) {
  if (rows.length < 2) return <p className="empty-small">The race chart appears after two days of results.</p>;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          tick={{ fill: "var(--muted)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
        <Tooltip
          formatter={(v) => fmtPct(typeof v === "number" ? v : null)}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
        />
        <Legend />
        <Line name="SPY (reference)" dataKey="spy" stroke="var(--muted)" strokeDasharray="6 4" dot={false} strokeWidth={2} isAnimationActive={false} />
        {people.map((p) => (
          <Line key={p.id} name={p.displayName} dataKey={p.id} stroke={p.color} dot={false} strokeWidth={3} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
