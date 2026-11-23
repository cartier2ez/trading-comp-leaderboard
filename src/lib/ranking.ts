// Who's winning. The server computes each person's numbers; THE scoring rule
// lives in `scoreOf` below.

import type { Account, Dataset, Mood, Person, Stats } from "./types";

export interface Standing {
  person: Person;
  rank: number | null; // null = no counted report for this account yet
  mood: Mood | null;
  stats: Stats | null;
}

/** Scoring rule: highest total % return wins. */
function scoreOf(s: Standing): number | null {
  return s.stats?.totalReturnPct ?? null;
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
  const standings = ds.people.map(
    (person): Standing => ({
      person,
      rank: null,
      mood: null,
      stats: ds.stats.find((s) => s.personId === person.id && s.account === account) ?? null,
    }),
  );
  const ranks = assignRanks(standings.map(scoreOf));
  standings.forEach((s, i) => {
    s.rank = ranks[i] ?? null;
    s.mood = moodFor(s.rank, ranks);
  });
  return standings.sort(
    (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.person.displayName.localeCompare(b.person.displayName),
  );
}
