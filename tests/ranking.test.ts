import { describe, expect, it } from "vitest";
import { raceRows } from "../src/lib/chart";
import { betRecord } from "../src/lib/format";
import { detectOvertakes } from "../src/lib/overtakes";
import { assignRanks, computeStandings, moodFor } from "../src/lib/ranking";
import { isStale, seasonPhase, timeUntil } from "../src/lib/time";
import type { Account, Dataset, DayClose, Season, Stats } from "../src/lib/types";

const season: Season = {
  id: "s",
  name: "Polymarket",
  startsAt: "2026-12-01T05:00:00Z",
  endsAt: "2027-06-01T04:00:00Z",
  startEquity: 10000,
};

function stat(personId: string, total: number, account: Account = "paper"): Stats {
  return {
    personId,
    account,
    lastSeen: "2026-12-03T15:00:00Z",
    equity: 10000 * (1 + total / 100),
    totalReturnPct: total,
    todayPct: 0,
    maxDrawdownPct: 0,
    openPositions: null,
    settledBets: null,
    wonBets: null,
    feesPaid: null,
  };
}

function ds(stats: Stats[], closes: DayClose[] = []): Dataset {
  return {
    people: ["a", "b", "c"].map((id) => ({ id, displayName: id.toUpperCase(), color: "#000000", gifs: {} })),
    season,
    stats,
    closes,
    bets: [],
    checkIns: [],
    settings: { snapshotMinutes: 10, staleAfterMinutes: 45 },
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
    expect(moodFor(1, [1])).toBe("first");
    expect(moodFor(null, [1])).toBeNull();
  });

  it("orders people, keeps accounts apart and leaves non-reporters unranked", () => {
    const data = ds([stat("a", 1), stat("b", 4), stat("c", 9, "live")]);
    expect(computeStandings(data, "paper").map((s) => [s.person.id, s.rank])).toEqual([["b", 1], ["a", 2], ["c", null]]);
    expect(computeStandings(data, "live")[0]!.person.id).toBe("c");
  });

  it("detects overtakes", () => {
    const before = computeStandings(ds([stat("a", 2), stat("b", 1)]), "paper");
    const after = computeStandings(ds([stat("a", 2), stat("b", 3)]), "paper");
    expect(detectOvertakes(before, after)).toMatchObject([{ passer: "B", passed: "A", newRank: 1 }]);
  });
});

describe("race chart rows", () => {
  it("goes start, closes, now, and works on day one", () => {
    const closes: DayClose[] = [{ personId: "a", account: "paper", date: "2026-12-01", totalReturnPct: 1 }];
    const data = ds([stat("a", 2), stat("b", -1)], closes);
    expect(raceRows(data, "paper", computeStandings(data, "paper"))).toEqual([
      { label: "Start", a: 0, b: 0 },
      { label: "12-01", a: 1 },
      { label: "Now", a: 2, b: -1 },
    ]);
    const none = ds([]);
    expect(raceRows(none, "paper", computeStandings(none, "paper"))).toEqual([]);
  });
});

describe("time", () => {
  const at = (s: string) => new Date(s);
  it("knows the season phase", () => {
    expect(seasonPhase(season, at("2026-12-01T04:59:59Z"))).toBe("before");
    expect(seasonPhase(season, at("2026-12-01T05:00:00Z"))).toBe("running");
    expect(seasonPhase(season, at("2027-06-01T04:00:00Z"))).toBe("over");
  });

  it("marks silent bots stale 24/7, but only while the season runs", () => {
    const last = "2026-12-05T08:00:00Z"; // a Saturday, 3 AM in New York
    expect(isStale(last, season, 45, at("2026-12-05T08:45:00Z"))).toBe(false);
    expect(isStale(last, season, 45, at("2026-12-05T08:46:00Z"))).toBe(true);
    expect(isStale(last, season, 45, at("2027-07-01T00:00:00Z"))).toBe(false);
    expect(isStale(null, season, 45, at("2026-12-05T08:46:00Z"))).toBe(false);
  });

  it("counts down", () => {
    expect(timeUntil("2026-12-01T05:00:00Z", at("2026-11-23T05:00:00Z"))).toBe("8 days");
    expect(timeUntil("2026-12-01T05:00:00Z", at("2026-12-01T04:48:00Z"))).toBe("12 min");
  });
});

describe("bet record", () => {
  it("shows only what the bot sends", () => {
    expect(betRecord(stat("a", 0))).toBeNull();
    expect(betRecord({ ...stat("a", 0), settledBets: 0, wonBets: 0 })).toBe("0 settled");
    expect(betRecord({ ...stat("a", 0), settledBets: 14, wonBets: 8, openPositions: 3, feesPaid: 12.4 })).toBe(
      "14 settled · 57% won · 3 open · $12.40 fees",
    );
  });
});
