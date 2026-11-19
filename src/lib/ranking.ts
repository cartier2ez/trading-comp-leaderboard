// Who's winning. THE scoring rule lives in `scoreOf` below: change it there
// if the Nov 19 call picks something other than total % return.

import { etDate } from "./time";
import type { Account, DailyRecord, Dataset, Mood, Person, Snapshot } from "./types";

export interface Standing {
  person: Person;
  rank: number | null; // null = hasn't reported for this account yet
  mood: Mood | null;
  totalReturnPct: number | null;
  todayPct: number | null;
  maxDrawdownPct: number | null; // <= 0
  equity: number | null;
  strategy: string | null;
  lastSeen: string | null; // ISO timestamp of the latest report
  source: "snapshot" | "daily" | null;
}

const ms = (iso: string): number => Date.parse(iso);

/** Scoring rule: highest total % return wins (Jon, Nov 18 2026; final on the call). */
function scoreOf(s: Standing): number | null {
  return s.totalReturnPct;
}

/** Max peak-to-trough drop of a series of total % returns, as a percent <= 0. */
export function maxDrawdownPct(totalReturnsPct: number[]): number | null {
  if (totalReturnsPct.length === 0) return null;
  let peak = -Infinity;
  let worst = 0;
  for (const t of totalReturnsPct) {
    const wealth = 1 + t / 100;
    peak = Math.max(peak, wealth);
    worst = Math.min(worst, wealth / peak - 1);
  }
  return worst * 100;
}

/** Competition ranking (1, 1, 3) by score, highest first. Unscored people get null. */
export function assignRanks(scores: (number | null)[]): (number | null)[] {
  return scores.map((s) => (s === null ? null : 1 + scores.filter((o) => o !== null && o > s).length));
}

/** 1st = happy, last = crying, everyone else = straight face. */
export function moodFor(rank: number | null, ranks: (number | null)[]): Mood | null {
  if (rank === null) return null;
  const ranked = ranks.filter((r): r is number => r !== null);
  if (rank === 1) return "first";
  return rank === Math.max(...ranked) ? "third" : "second";
}

export function computeStandings(ds: Dataset, account: Account): Standing[] {
  const standings = ds.people.map((person): Standing => {
    const daily = ds.daily
      .filter((d) => d.personId === person.id && d.account === account)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latestDaily: DailyRecord | undefined = daily[daily.length - 1];
    const latestSnap: Snapshot | undefined = ds.snapshots
      .filter((s) => s.personId === person.id && s.account === account)
      .reduce<Snapshot | undefined>((best, s) => (!best || ms(s.ts) > ms(best.ts) ? s : best), undefined);

    // A snapshot wins only if it's from a later trading day than the latest
    // daily close (on the same day, the close is the official number).
    const useSnap =
      latestSnap !== undefined &&
      (latestDaily === undefined || etDate(new Date(latestSnap.ts)) > latestDaily.date);

    let totalReturnPct: number | null = null;
    let todayPct: number | null = null;
    let equity: number | null = null;
    let lastSeen: string | null = null;
    let source: Standing["source"] = null;
    const series = daily.map((d) => d.totalReturnPct);

    if (useSnap && latestSnap) {
      const snapDay = etDate(new Date(latestSnap.ts));
      const prevClose = [...daily].reverse().find((d) => d.date < snapDay);
      const base = 1 + (prevClose?.totalReturnPct ?? 0) / 100;
      totalReturnPct = latestSnap.totalReturnPct;
      todayPct = ((1 + totalReturnPct / 100) / base - 1) * 100;
      equity = latestSnap.equity;
      lastSeen = latestSnap.ts;
      source = "snapshot";
      series.push(totalReturnPct);
    } else if (latestDaily) {
      totalReturnPct = latestDaily.totalReturnPct;
      todayPct = latestDaily.dayReturnPct;
      equity = latestDaily.equity;
      lastSeen =
        latestSnap && ms(latestSnap.ts) > ms(latestDaily.receivedAt) ? latestSnap.ts : latestDaily.receivedAt;
      source = "daily";
    }

    return {
      person,
      rank: null,
      mood: null,
      totalReturnPct,
      todayPct,
      maxDrawdownPct: maxDrawdownPct(series),
      equity,
      strategy: latestDaily?.strategy ?? null,
      lastSeen,
      source,
    };
  });

  const ranks = assignRanks(standings.map(scoreOf));
  standings.forEach((s, i) => {
    s.rank = ranks[i] ?? null;
    s.mood = moodFor(s.rank, ranks);
  });
  return standings.sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.person.displayName.localeCompare(b.person.displayName),
  );
}
