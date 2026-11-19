import { describe, expect, it } from "vitest";
import { detectOvertakes } from "../src/lib/overtakes";
import { assignRanks, computeStandings, maxDrawdownPct, moodFor } from "../src/lib/ranking";
import type { DailyRecord, Dataset, Snapshot } from "../src/lib/types";

const people = ["a", "b", "c"].map((id) => ({ id, displayName: id.toUpperCase(), color: "#000000", gifs: {} }));

function day(personId: string, date: string, total: number, dayPct = 0): DailyRecord {
  return {
    personId,
    account: "paper",
    date,
    equity: 100000 * (1 + total / 100),
    dayReturnPct: dayPct,
    totalReturnPct: total,
    benchmarkReturnPct: 0,
    strategy: null,
    trackingSince: "2026-11-16",
    receivedAt: `${date}T21:20:00Z`,
  };
}

function snap(personId: string, ts: string, total: number): Snapshot {
  return { personId, account: "paper", ts, equity: 100000 * (1 + total / 100), totalReturnPct: total };
}

function ds(daily: DailyRecord[], snapshots: Snapshot[] = []): Dataset {
  return {
    people,
    daily,
    snapshots,
    settings: { competitionStart: null, competitionEnd: null, snapshotMinutes: 10, staleAfterMinutes: 30 },
  };
}

describe("ranking", () => {
  it("ranks by total return with shared ranks on ties", () => {
    expect(assignRanks([1, 3, 1, null])).toEqual([2, 1, 2, null]);
    expect(assignRanks([2, 2, 1])).toEqual([1, 1, 3]);
  });

  it("maps ranks to moods: first happy, last crying, middle straight", () => {
    const ranks = [1, 2, 3];
    expect(ranks.map((r) => moodFor(r, ranks))).toEqual(["first", "second", "third"]);
    expect(moodFor(1, [1, 1, 3])).toBe("first");
    expect(moodFor(1, [1])).toBe("first");
    expect(moodFor(null, [1])).toBeNull();
  });

  it("computes max drawdown from the return series", () => {
    expect(maxDrawdownPct([0, 10, -1])).toBeCloseTo((0.99 / 1.1 - 1) * 100);
    expect(maxDrawdownPct([1, 2, 3])).toBe(0);
    expect(maxDrawdownPct([])).toBeNull();
  });

  it("uses a newer-day snapshot for live ranking and today's %", () => {
    const data = ds(
      [day("a", "2026-11-18", 2, 0.5), day("b", "2026-11-18", 1), day("c", "2026-11-18", 0)],
      [snap("b", "2026-11-19T15:00:00Z", 4.03)], // b: 1% -> 4.03% total = +3% today
    );
    const s = computeStandings(data, "paper");
    expect(s.map((x) => x.person.id)).toEqual(["b", "a", "c"]);
    expect(s[0]!.source).toBe("snapshot");
    expect(s[0]!.todayPct).toBeCloseTo(3);
    expect(s[1]!.todayPct).toBe(0.5);
    expect(s.map((x) => x.mood)).toEqual(["first", "second", "third"]);
  });

  it("prefers the daily close over a same-day snapshot", () => {
    const data = ds([day("a", "2026-11-19", 1)], [snap("a", "2026-11-19T20:50:00Z", 9)]);
    expect(computeStandings(data, "paper")[0]!.totalReturnPct).toBe(1);
  });

  it("keeps people without data unranked and last", () => {
    const s = computeStandings(ds([day("b", "2026-11-18", 1)]), "paper");
    expect(s[0]!.person.id).toBe("b");
    expect(s.slice(1).every((x) => x.rank === null)).toBe(true);
    expect(computeStandings(ds([day("b", "2026-11-18", 1)]), "live").every((x) => x.rank === null)).toBe(true);
  });

  it("detects overtakes between two rankings", () => {
    const before = computeStandings(ds([day("a", "2026-11-18", 2), day("b", "2026-11-18", 1)]), "paper");
    const after = computeStandings(
      ds([day("a", "2026-11-18", 2), day("b", "2026-11-18", 1)], [snap("b", "2026-11-19T15:00:00Z", 3)]),
      "paper",
    );
    const o = detectOvertakes(before, after);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ passer: "B", passed: "A", newRank: 1 });
  });
});
