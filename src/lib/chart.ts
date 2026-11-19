import type { Standing } from "./ranking";
import type { Account, Dataset } from "./types";

export const LIVE_LABEL = "Now";

export type ChartRow = { label: string } & Record<string, number | string | null>;

/**
 * Rows for the race chart: one per trading day, a column per person (total %)
 * plus `spy`. The SPY line uses the benchmark reported by whoever started
 * tracking earliest, so it covers the whole x-axis. (If you start on different
 * days your SPY numbers differ; see "open rules" in CLAUDE.md.)
 */
export function raceRows(ds: Dataset, account: Account, standings: Standing[]): ChartRow[] {
  const start = ds.settings.competitionStart;
  const records = ds.daily.filter((d) => d.account === account && (!start || d.date >= start));
  if (records.length === 0) return [];

  const earliest = records.reduce((m, d) => (d.trackingSince < m ? d.trackingSince : m), records[0]!.trackingSince);
  const dates = [...new Set(records.map((d) => d.date))].sort();

  const rows: ChartRow[] = dates.map((date) => {
    const row: ChartRow = { label: date.slice(5) };
    const spy = records.filter((d) => d.date === date && d.trackingSince === earliest).map((d) => d.benchmarkReturnPct);
    row.spy = spy.length > 0 ? spy.reduce((a, b) => a + b, 0) / spy.length : null;
    for (const d of records.filter((r) => r.date === date)) row[d.personId] = d.totalReturnPct;
    return row;
  });

  // Live point for anyone whose latest number is an intraday snapshot.
  const live = standings.filter((s) => s.source === "snapshot" && s.totalReturnPct !== null);
  if (live.length > 0) {
    const row: ChartRow = { label: LIVE_LABEL, spy: null };
    for (const s of live) row[s.person.id] = s.totalReturnPct;
    rows.push(row);
  }
  return rows;
}

/** One person's line plus their own SPY line, for the card sparkline. */
export function personRows(ds: Dataset, account: Account, standing: Standing): ChartRow[] {
  const rows: ChartRow[] = ds.daily
    .filter((d) => d.account === account && d.personId === standing.person.id)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ label: d.date.slice(5), you: d.totalReturnPct, spy: d.benchmarkReturnPct }));
  if (standing.source === "snapshot" && standing.totalReturnPct !== null) {
    rows.push({ label: LIVE_LABEL, you: standing.totalReturnPct, spy: null });
  }
  return rows;
}
