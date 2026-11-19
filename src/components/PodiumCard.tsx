import type { CSSProperties } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { MOOD_EMOJI, MOOD_TAGLINE, RANK_MEDAL } from "../config";
import type { ChartRow } from "../lib/chart";
import { fmtMoney, fmtPct, tone } from "../lib/format";
import type { Standing } from "../lib/ranking";
import { relativeTime } from "../lib/time";

interface Props {
  standing: Standing;
  stale: boolean;
  now: Date;
  spark: ChartRow[];
  cardRef: (el: HTMLElement | null) => void;
}

export function PodiumCard({ standing: s, stale, now, spark, cardRef }: Props) {
  const mood = s.mood ?? "second";
  const gif = s.person.gifs[mood];
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
        <span className={`seen ${stale ? "stale" : ""}`} title={s.lastSeen ?? undefined}>
          {stale ? "💤 " : ""}
          {relativeTime(s.lastSeen, now)}
        </span>
      </div>

      {/* Keyed on mood so the pop animation replays when the face changes. */}
      <div className="face" key={mood}>
        {gif ? <img src={gif} alt={`${s.person.displayName}, ${mood} place face`} /> : <span>{MOOD_EMOJI[mood]}</span>}
      </div>

      <h2 className="name">{s.person.displayName}</h2>
      <p className="tagline">{MOOD_TAGLINE[mood]}</p>

      <p className={`total ${tone(s.totalReturnPct)}`}>{fmtPct(s.totalReturnPct)}</p>

      <dl className="stats">
        <div>
          <dt>Today</dt>
          <dd className={tone(s.todayPct)}>{fmtPct(s.todayPct)}</dd>
        </div>
        <div>
          <dt>Max DD</dt>
          <dd>{fmtPct(s.maxDrawdownPct, 1)}</dd>
        </div>
        <div>
          <dt>Equity</dt>
          <dd>{fmtMoney(s.equity)}</dd>
        </div>
      </dl>

      {spark.length > 1 && (
        <div className="spark" aria-hidden="true">
          <ResponsiveContainer width="100%" height={56}>
            <LineChart data={spark} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Line dataKey="spy" stroke="var(--muted)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line dataKey="you" stroke={s.person.color} dot={false} strokeWidth={2.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {s.strategy && <p className="strategy">{s.strategy}</p>}
    </article>
  );
}
