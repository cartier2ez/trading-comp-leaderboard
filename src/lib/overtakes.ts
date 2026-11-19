import type { Standing } from "./ranking";

export interface Overtake {
  id: string;
  passer: string;
  passed: string;
  newRank: number;
}

/** Pairs that swapped order between two rankings: "A was behind B, now ahead". */
export function detectOvertakes(prev: Standing[], next: Standing[]): Overtake[] {
  const prevRank = new Map(prev.map((s) => [s.person.id, s.rank]));
  const out: Overtake[] = [];
  for (const a of next) {
    for (const b of next) {
      if (a === b || a.rank === null || b.rank === null) continue;
      const pa = prevRank.get(a.person.id);
      const pb = prevRank.get(b.person.id);
      if (pa == null || pb == null) continue;
      if (pa > pb && a.rank < b.rank) {
        out.push({
          id: `${a.person.id}>${b.person.id}@${Date.now()}`,
          passer: a.person.displayName,
          passed: b.person.displayName,
          newRank: a.rank,
        });
      }
    }
  }
  return out;
}
