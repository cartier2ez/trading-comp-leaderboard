import { fmtMoney, tone } from "../lib/format";
import { relativeTime } from "../lib/time";
import type { Person, SettledBet } from "../lib/types";

const RESULT = { won: "✅ Won", lost: "❌ Lost", push: "➖ Push" } as const;

/** Finished bets only. Open bets are never sent to the dashboard. */
export function BetList({ bets, people, now }: { bets: SettledBet[]; people: Person[]; now: Date }) {
  if (bets.length === 0) return <p className="empty-small">No settled bets yet.</p>;
  return (
    <ul className="bets">
      {bets.map((b) => {
        const person = people.find((p) => p.id === b.personId);
        return (
          <li key={`${b.personId}|${b.marketSlug}|${b.side}|${b.settledAt}`}>
            <span className="bet-who">
              <span className="bet-dot" style={{ background: person?.color }} />
              {person?.displayName ?? "?"}
            </span>
            <span className="bet-what">
              {b.marketTitle}
              <span className="muted">
                {" "}
                · {b.side} · {relativeTime(b.settledAt, now)}
              </span>
            </span>
            <span className="bet-stake">{fmtMoney(b.stake)} bet</span>
            <span className={`bet-result ${tone(b.pnl)}`}>
              {RESULT[b.result]} {b.pnl > 0 ? "+" : ""}
              {fmtMoney(b.pnl)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
