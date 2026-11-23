import type { Standing } from "./ranking";
import type { Account, Dataset } from "./types";

export const START_LABEL = "Start";
export const LIVE_LABEL = "Now";

export type ChartRow = { label: string } & Record<string, number | string | null>;

/** Start (everyone at 0%), one row per finished New York day, then the live value. */
export function raceRows(ds: Dataset, account: Account, standings: Standing[]): ChartRow[] {
  const ranked = standings.filter((s) => s.stats !== null);
  if (ranked.length === 0) return [];
  const first: ChartRow = { label: START_LABEL };
  const last: ChartRow = { label: LIVE_LABEL };
  for (const s of ranked) {
    first[s.person.id] = 0;
    last[s.person.id] = s.stats!.totalReturnPct;
  }
  const closes = ds.closes.filter((c) => c.account === account);
  const days = [...new Set(closes.map((c) => c.date))].sort().map((date) => {
    const row: ChartRow = { label: date.slice(5) };
    for (const c of closes) if (c.date === date) row[c.personId] = c.totalReturnPct;
    return row;
  });
  return [first, ...days, last];
}
