import { describe, expect, it } from "vitest";
import { MAX_BETS_PER_REPORT, validateReport } from "../supabase/functions/report/validate";

const NOW = new Date("2026-12-03T20:00:00Z");
const snap = { schema_version: 2, type: "snapshot", account: "paper", equity: 10123.45 };
const bet = {
  market_slug: "example-market",
  market_title: "Will it happen?",
  side: "Yes",
  stake: 50,
  pnl: 38.2,
  result: "won",
  settled_at: "2026-12-03T18:20:00Z",
};
const bets = (...list: unknown[]) => ({ schema_version: 2, type: "bets", account: "paper", bets: list });

function problems(input: unknown): string {
  const r = validateReport(input, NOW);
  return r.ok ? "" : r.problems.join("\n");
}

describe("snapshots", () => {
  it("accepts equity alone, and every optional field", () => {
    expect(validateReport(snap, NOW)).toEqual({
      ok: true,
      report: {
        type: "snapshot",
        account: "paper",
        equity: 10123.45,
        open_positions: null,
        settled_bets: null,
        won_bets: null,
        fees_paid: null,
        sim_version: null,
      },
    });
    const full = { ...snap, open_positions: 4, settled_bets: 12, won_bets: 7, fees_paid: 3.2, sim_version: "0.4.13+us.2" };
    expect(validateReport(full, NOW).ok).toBe(true);
  });

  it("accepts a bankrupt account", () => {
    expect(validateReport({ ...snap, equity: 0 }, NOW).ok).toBe(true);
  });

  it("rejects v1, daily reports and v1 fields with a clear reason", () => {
    expect(problems({ type: "snapshot", account: "paper", equity: 1, total_return_pct: 0 })).toContain("Version 1");
    expect(problems({ ...snap, schema_version: 1 })).toContain("Version 1");
    expect(problems({ ...snap, schema_version: "2" })).toContain("schema_version");
    expect(problems({ ...snap, type: "daily" })).toContain('no "daily" report');
    expect(problems({ ...snap, total_return_pct: 1 })).toContain('Unknown field "total_return_pct"');
    expect(problems({ ...snap, account_number: "X1" })).toContain('Unknown field "account_number"');
  });

  it("rejects bad numbers and inconsistent counts", () => {
    expect(problems({ ...snap, equity: -1 })).toContain('"equity" must be >= 0');
    expect(problems({ ...snap, equity: "10" })).toContain("finite number");
    expect(problems({ ...snap, equity: undefined })).toContain("required");
    expect(problems({ ...snap, open_positions: 1.5 })).toContain("whole number");
    expect(problems({ ...snap, fees_paid: -1 })).toContain('"fees_paid"');
    expect(problems({ ...snap, won_bets: 1 })).toContain("needs");
    expect(problems({ ...snap, settled_bets: 1, won_bets: 2 })).toContain("can't be more");
    expect(problems({ ...snap, account: "margin" })).toContain('"account"');
    expect(problems({ ...snap, sim_version: "<b>" })).toContain('"sim_version"');
  });
});

describe("settled bets", () => {
  it("accepts finished bets and normalizes settled_at, so a resend matches", () => {
    const r = validateReport(bets({ ...bet, settled_at: "2026-12-03T13:20:00-05:00" }), NOW);
    expect(r.ok && r.report.type === "bets" && r.report.bets[0]!.settled_at).toBe("2026-12-03T18:20:00.000Z");
  });

  it("rejects open or unfinished bets", () => {
    expect(problems(bets({ ...bet, result: "open" }))).toContain('"bets[0].result"');
    expect(problems(bets({ ...bet, settled_at: "2026-12-04T18:20:00Z" }))).toContain("in the future");
    expect(problems(bets({ ...bet, settled_at: undefined }))).toContain("settled_at");
    expect(problems(bets({ ...bet, order_id: "abc" }))).toContain('Unknown field "bets[0].order_id"');
  });

  it("rejects times without a zone and impossible dates", () => {
    expect(problems(bets({ ...bet, settled_at: "2026-12-03T18:20:00" }))).toContain("time zone");
    expect(problems(bets({ ...bet, settled_at: "2026-02-30T18:20:00Z" }))).toContain("settled_at");
  });

  it("rejects impossible money and text", () => {
    expect(problems(bets({ ...bet, stake: 0 }))).toContain("must be > 0");
    expect(problems(bets({ ...bet, result: "lost", pnl: 5 }))).toContain("lost bet");
    expect(problems(bets({ ...bet, result: "lost", pnl: -60 }))).toContain("more than the stake");
    expect(problems(bets({ ...bet, market_title: "a\nb" }))).toContain("market_title");
    expect(problems(bets({ ...bet, market_title: "x".repeat(201) }))).toContain("market_title");
    expect(problems(bets({ ...bet, market_slug: "has space" }))).toContain("market_slug");
  });

  it("rejects duplicates, empty lists and oversized lists", () => {
    expect(problems(bets(bet, { ...bet, settled_at: "2026-12-03T13:20:00-05:00" }))).toContain("repeats a bet");
    expect(problems(bets())).toContain("list of 1-");
    expect(problems(bets(...Array.from({ length: MAX_BETS_PER_REPORT + 1 }, () => bet)))).toContain("list of 1-");
    expect(problems(bets(null))).toContain("must be an object");
  });

  it("rejects non-objects and unknown types", () => {
    expect(validateReport([], NOW).ok).toBe(false);
    expect(validateReport(null, NOW).ok).toBe(false);
    expect(problems({ ...snap, type: "weekly" })).toContain('"type"');
  });
});
