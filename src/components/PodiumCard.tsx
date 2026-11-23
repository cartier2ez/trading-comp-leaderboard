import type { CSSProperties } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { MOOD_EMOJI, MOOD_TAGLINE, RANK_MEDAL } from "../config";
import type { ChartRow } from "../lib/chart";
import { betRecord, fmtMoney, fmtPct, tone } from "../lib/format";
import type { Standing } from "../lib/ranking";
import { relativeTime } from "../lib/time";
import type { Stats } from "../lib/types";

interface Props {
  standing: Standing;
  stats: Stats;
  stale: boolean;
  now: Date;
  rows: ChartRow[];
  cardRef: (el: HTMLElement | null) => void;
}

export function PodiumCard({ standing: s, stats, stale, now, rows, cardRef }: Props) {
  const mood = s.mood ?? "second";
  const gif = s.person.gifs[mood];
  const record = betRecord(stats);
  return (
    <article
      ref={cardRef}
      className={`card rank-${s.rank ?? "none"}`}
      style={{ "--person": s.person.color } as CSSProperties}
    >
      <div className="card-top">
        <span className="medal" aria-label={`Rank ${s.rank}`}>
          {s.rank !== null ? (RANK_MEDAL[s.rank] ?? `#${s.rank}`) : "…"}
        </span>
        <span className={`seen ${stale ? "stale" : ""}`} title={stats.lastSeen}>
          {stale ? "💤 " : ""}
          {relativeTime(stats.lastSeen, now)}
        </span>
      </div>

      {/* Keyed on mood so the pop animation replays when the face changes. */}
      <div className="face" key={mood}>
        {gif ? <img src={gif} alt={`${s.person.displayName}, ${mood} place face`} /> : <span>{MOOD_EMOJI[mood]}</span>}
      </div>

      <h2 className="name">{s.person.displayName}</h2>
      <p className="tagline">{MOOD_TAGLINE[mood]}</p>

      <p className={`total ${tone(stats.totalReturnPct)}`}>{fmtPct(stats.totalReturnPct)}</p>

      <dl className="stats">
        <div>
          <dt>Today</dt>
          <dd className={tone(stats.todayPct)}>{fmtPct(stats.todayPct)}</dd>
        </div>
        <div>
          <dt>Max DD</dt>
          <dd>{fmtPct(stats.maxDrawdownPct, 1)}</dd>
        </div>
        <div>
          <dt>Equity</dt>
          <dd>{fmtMoney(stats.equity)}</dd>
        </div>
      </dl>

      <div className="spark" aria-hidden="true">
        <ResponsiveContainer width="100%" height={56}>
          <LineChart data={rows} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
            <YAxis hide domain={[(min: number) => Math.min(min, 0), (max: number) => Math.max(max, 0)]} />
            <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="4 3" />
            <Line
              dataKey={s.person.id}
              stroke={s.person.color}
              dot={false}
              strokeWidth={2.5}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {record && <p className="record">{record}</p>}
    </article>
  );
}
