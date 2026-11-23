// The data contract for bot reports (schema v2). This file is the single source
// of truth: BOT_GUIDE.md documents it, the `report` Edge Function enforces it.
// Pure TypeScript, no Deno or Node APIs, so the web app's tests can run it.

export type Account = "paper" | "live";
export type BetResult = "won" | "lost" | "push";

export interface SnapshotReport {
  type: "snapshot";
  account: Account;
  equity: number;
  open_positions: number | null;
  settled_bets: number | null;
  won_bets: number | null;
  fees_paid: number | null;
  sim_version: string | null;
}

export interface SettledBet {
  market_slug: string;
  market_title: string;
  side: string;
  stake: number;
  pnl: number;
  result: BetResult;
  settled_at: string; // ISO, normalized to UTC milliseconds
}

export interface BetsReport {
  type: "bets";
  account: Account;
  bets: SettledBet[];
}

export type Report = SnapshotReport | BetsReport;

export type ValidationResult = { ok: true; report: Report } | { ok: false; problems: string[] };

export const SCHEMA_VERSION = 2;
export const MAX_BETS_PER_REPORT = 50;

/** A bet can't settle in the future; this only forgives a slightly fast clock. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

const SNAPSHOT_FIELDS = [
  "schema_version",
  "type",
  "account",
  "equity",
  "open_positions",
  "settled_bets",
  "won_bets",
  "fees_paid",
  "sim_version",
];
const BETS_FIELDS = ["schema_version", "type", "account", "bets"];
const BET_FIELDS = ["market_slug", "market_title", "side", "stake", "pnl", "result", "settled_at"];

const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Field readers that collect readable problems instead of throwing. */
function reader(obj: Obj, problems: string[], at: string) {
  const name = (k: string) => `"${at}${k}"`;
  return {
    // Unknown fields are rejected: it keeps everyone's data identical in shape
    // and stops open bets, account ids or keys from leaking in.
    onlyFields(allowed: string[]) {
      for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) problems.push(`Unknown field ${name(key)}. Allowed: ${allowed.join(", ")}.`);
      }
    },
    num(key: string, o: { min?: number; above?: number; max?: number }): number {
      const v = obj[key];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        problems.push(`${name(key)} must be a finite number${v === undefined ? " (it is required)" : ""}.`);
        return 0;
      }
      if (o.min !== undefined && v < o.min) problems.push(`${name(key)} must be >= ${o.min}, got ${v}.`);
      if (o.above !== undefined && v <= o.above) problems.push(`${name(key)} must be > ${o.above}, got ${v}.`);
      if (o.max !== undefined && v > o.max) problems.push(`${name(key)} must be <= ${o.max}, got ${v}.`);
      return v;
    },
    optionalNum(key: string, o: { min?: number; max?: number; integer?: boolean }): number | null {
      if (obj[key] === undefined || obj[key] === null) return null;
      const v = this.num(key, o);
      if (o.integer && !Number.isInteger(v)) problems.push(`${name(key)} must be a whole number, got ${v}.`);
      return v;
    },
    text(key: string, max: number, pattern?: RegExp): string {
      const v = obj[key];
      const s = typeof v === "string" ? v.trim() : "";
      if (s.length === 0 || s.length > max || CONTROL.test(s) || (pattern && !pattern.test(s))) {
        problems.push(
          `${name(key)} must be text of 1-${max} characters${pattern ? ` matching ${pattern.source}` : " on one line"}.`,
        );
      }
      return s;
    },
  };
}

export function validateReport(input: unknown, now: Date): ValidationResult {
  if (!isObj(input)) return { ok: false, problems: ["Body must be a JSON object."] };

  if (input.schema_version !== SCHEMA_VERSION) {
    return {
      ok: false,
      problems: [
        `"schema_version" must be ${SCHEMA_VERSION}. Version 1 (the stock competition) is closed; ` +
          "update your bot using the current BOT_GUIDE.md.",
      ],
    };
  }
  if (input.type === "daily") {
    return {
      ok: false,
      problems: ['There is no "daily" report in version 2. The server derives each day\'s close from your snapshots.'],
    };
  }
  if (input.type !== "snapshot" && input.type !== "bets") {
    return { ok: false, problems: ['"type" must be "snapshot" or "bets".'] };
  }

  const problems: string[] = [];
  const r = reader(input, problems, "");
  r.onlyFields(input.type === "snapshot" ? SNAPSHOT_FIELDS : BETS_FIELDS);
  if (input.account !== "paper" && input.account !== "live") {
    problems.push('"account" must be "paper" (simulation) or "live" (real money).');
  }
  const account = input.account as Account;

  if (input.type === "snapshot") {
    const report: SnapshotReport = {
      type: "snapshot",
      account,
      equity: r.num("equity", { min: 0, max: 1e9 }),
      open_positions: r.optionalNum("open_positions", { min: 0, max: 1e6, integer: true }),
      settled_bets: r.optionalNum("settled_bets", { min: 0, max: 1e6, integer: true }),
      won_bets: r.optionalNum("won_bets", { min: 0, max: 1e6, integer: true }),
      fees_paid: r.optionalNum("fees_paid", { min: 0, max: 1e9 }),
      sim_version:
        input.sim_version === undefined || input.sim_version === null
          ? null
          : r.text("sim_version", 40, /^[A-Za-z0-9._+-]+$/),
    };
    if (report.won_bets !== null) {
      if (report.settled_bets === null) problems.push('"won_bets" needs "settled_bets" too.');
      else if (report.won_bets > report.settled_bets) problems.push('"won_bets" can\'t be more than "settled_bets".');
    }
    return problems.length > 0 ? { ok: false, problems } : { ok: true, report };
  }

  const list = input.bets;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BETS_PER_REPORT) {
    problems.push(`"bets" must be a list of 1-${MAX_BETS_PER_REPORT} settled bets.`);
    return { ok: false, problems };
  }
  const seen = new Set<string>();
  const bets = list.map((raw: unknown, i): SettledBet | null => {
    if (!isObj(raw)) {
      problems.push(`"bets[${i}]" must be an object.`);
      return null;
    }
    const at = `bets[${i}].`;
    const b = reader(raw, problems, at);
    b.onlyFields(BET_FIELDS);
    const bet: SettledBet = {
      market_slug: b.text("market_slug", 200, /^[A-Za-z0-9._-]+$/),
      market_title: b.text("market_title", 200),
      side: b.text("side", 60),
      stake: b.num("stake", { above: 0, max: 1e9 }),
      pnl: b.num("pnl", { min: -1e9, max: 1e9 }),
      result: raw.result as BetResult,
      settled_at: "",
    };
    if (bet.result !== "won" && bet.result !== "lost" && bet.result !== "push") {
      problems.push(`"${at}result" must be "won", "lost" or "push".`);
    }
    if (bet.result === "lost" && bet.pnl > 0) problems.push(`"${at}pnl" can't be positive for a lost bet.`);
    if (bet.pnl < -bet.stake - 0.01) problems.push(`"${at}pnl" can't lose more than the stake (stake includes fees).`);

    const when = typeof raw.settled_at === "string" ? raw.settled_at : "";
    const match = ISO_WITH_ZONE.exec(when);
    const ms = match && isCalendarDate(match[1]!) ? Date.parse(when) : NaN;
    if (Number.isNaN(ms)) {
      problems.push(`"${at}settled_at" must be a date-time with a time zone, like "2026-12-03T18:20:00Z".`);
      return null;
    }
    if (ms > now.getTime() + CLOCK_SKEW_MS) {
      problems.push(`"${at}settled_at" is in the future. Only send bets that are finished.`);
    }
    bet.settled_at = new Date(ms).toISOString();

    const key = JSON.stringify([bet.market_slug, bet.side, bet.settled_at]);
    if (seen.has(key)) problems.push(`"bets[${i}]" repeats a bet (same market_slug, side and settled_at).`);
    seen.add(key);
    return bet;
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: { type: "bets", account, bets: bets.filter((b) => b !== null) } };
}
