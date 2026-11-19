import { describe, expect, it } from "vitest";
import { validateReport } from "../supabase/functions/report/validate";

const NOW = new Date("2026-11-19T22:00:00Z");

const daily = {
  type: "daily",
  account: "paper",
  date: "2026-11-19",
  equity: 100512.3,
  net_deposits: 0,
  day_return_pct: 0.42,
  total_return_pct: 0.51,
  benchmark: "SPY",
  benchmark_return_pct: 0.14,
  strategy: "trend_basket_sma210",
  tracking_since: "2026-11-18",
};

describe("validateReport", () => {
  it("accepts a valid snapshot and defaults net_deposits", () => {
    const r = validateReport({ type: "snapshot", account: "paper", equity: 100100, total_return_pct: 0.1 }, NOW);
    expect(r).toEqual({
      ok: true,
      report: { type: "snapshot", account: "paper", equity: 100100, total_return_pct: 0.1, net_deposits: 0 },
    });
  });

  it("accepts a valid daily record", () => {
    const r = validateReport(daily, NOW);
    expect(r.ok).toBe(true);
  });

  it("accepts Jon's current bot output (excess_return_pct, no account) once account is added", () => {
    const { net_deposits: _n, ...legacy } = daily;
    const r = validateReport({ ...legacy, excess_return_pct: 0.37 }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report).not.toHaveProperty("excess_return_pct");
  });

  it("rejects unknown fields, so account ids can't leak in", () => {
    const r = validateReport({ ...daily, account_number: "PA123" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(" ")).toContain('Unknown field "account_number"');
  });

  it("rejects bad types, ranges and dates with readable problems", () => {
    const r = validateReport(
      { ...daily, account: "margin", equity: -5, total_return_pct: "1%", date: "2026-13-01", tracking_since: "nope" },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.problems.join("\n");
      expect(all).toContain('"account"');
      expect(all).toContain('"equity" must be >');
      expect(all).toContain('"total_return_pct" must be a finite number');
      expect(all).toContain('"date"');
      expect(all).toContain('"tracking_since"');
    }
  });

  it("rejects future dates and tracking_since after date", () => {
    expect(validateReport({ ...daily, date: "2026-11-25" }, NOW).ok).toBe(false);
    expect(validateReport({ ...daily, tracking_since: "2026-11-20" }, NOW).ok).toBe(false);
  });

  it("rejects non-objects and unknown types", () => {
    expect(validateReport([], NOW).ok).toBe(false);
    expect(validateReport({ type: "weekly" }, NOW).ok).toBe(false);
  });
});
