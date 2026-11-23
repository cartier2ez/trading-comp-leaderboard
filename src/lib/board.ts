// Turns the race_board() JSON (snake_case, see the v2 migration) into app types.

import type { Account, Dataset, SettledBet } from "./types";

interface RawBoard {
  season: { id: string; name: string; starts_at: string; ends_at: string | null; start_equity: number } | null;
  stats: {
    person_id: string;
    account: Account;
    last_seen: string;
    equity: number;
    total_return_pct: number;
    today_pct: number;
    max_drawdown_pct: number;
    open_positions: number | null;
    settled_bets: number | null;
    won_bets: number | null;
    fees_paid: number | null;
  }[];
  closes: { person_id: string; account: Account; date: string; total_return_pct: number }[];
  check_ins: { person_id: string; at: string }[];
  bets: {
    person_id: string;
    account: Account;
    market_slug: string;
    market_title: string;
    side: string;
    stake: number;
    pnl: number;
    result: SettledBet["result"];
    settled_at: string;
  }[];
}

export function parseBoard(data: unknown): Omit<Dataset, "people" | "settings"> {
  const raw = data as RawBoard | null;
  if (!raw?.season) throw new Error("No season is set up.");
  return {
    season: {
      id: raw.season.id,
      name: raw.season.name,
      startsAt: raw.season.starts_at,
      endsAt: raw.season.ends_at,
      startEquity: raw.season.start_equity,
    },
    stats: raw.stats.map((s) => ({
      personId: s.person_id,
      account: s.account,
      lastSeen: s.last_seen,
      equity: s.equity,
      totalReturnPct: s.total_return_pct,
      todayPct: s.today_pct,
      maxDrawdownPct: s.max_drawdown_pct,
      openPositions: s.open_positions,
      settledBets: s.settled_bets,
      wonBets: s.won_bets,
      feesPaid: s.fees_paid,
    })),
    closes: raw.closes.map((c) => ({
      personId: c.person_id,
      account: c.account,
      date: c.date,
      totalReturnPct: c.total_return_pct,
    })),
    checkIns: raw.check_ins.map((c) => ({ personId: c.person_id, at: c.at })),
    bets: raw.bets.map((b) => ({
      personId: b.person_id,
      account: b.account,
      marketSlug: b.market_slug,
      marketTitle: b.market_title,
      side: b.side,
      stake: b.stake,
      pnl: b.pnl,
      result: b.result,
      settledAt: b.settled_at,
    })),
  };
}
