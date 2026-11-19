// The data contract for bot reports. This file is the single source of truth:
// BOT_GUIDE.md documents it, the `report` Edge Function enforces it.
// Pure TypeScript, no Deno or Node APIs, so the web app's tests can run it.

export type Account = "paper" | "live";

export interface SnapshotReport {
  type: "snapshot";
  account: Account;
  equity: number;
  total_return_pct: number;
  net_deposits: number;
}

export interface DailyReport {
  type: "daily";
  account: Account;
  date: string; // YYYY-MM-DD, the trading day this record closes
  equity: number;
  net_deposits: number;
  day_return_pct: number;
  total_return_pct: number;
  benchmark: string;
  benchmark_return_pct: number;
  strategy: string | null;
  tracking_since: string; // YYYY-MM-DD
}

export type Report = SnapshotReport | DailyReport;

export type ValidationResult =
  | { ok: true; report: Report }
  | { ok: false; problems: string[] };

export const SCHEMA_VERSION = 1;

const SNAPSHOT_FIELDS = ["type", "schema_version", "account", "equity", "total_return_pct", "net_deposits"];
const DAILY_FIELDS = [
  "type",
  "schema_version",
  "account",
  "date",
  "equity",
  "net_deposits",
  "day_return_pct",
  "total_return_pct",
  "benchmark",
  "benchmark_return_pct",
  "excess_return_pct", // accepted for compatibility, not stored (it's derivable)
  "strategy",
  "tracking_since",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDate(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? d : null;
}

export function validateReport(input: unknown, now: Date): ValidationResult {
  const problems: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, problems: ["Body must be a JSON object."] };
  }

  const type = input.type;
  if (type !== "snapshot" && type !== "daily") {
    return { ok: false, problems: ['"type" must be "snapshot" or "daily".'] };
  }

  // Unknown fields are rejected: it keeps all three bots' data identical in
  // shape, and stops account IDs or other details from leaking in.
  const allowed = type === "snapshot" ? SNAPSHOT_FIELDS : DAILY_FIELDS;
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      problems.push(`Unknown field "${key}". Allowed for ${type}: ${allowed.join(", ")}.`);
    }
  }

  if (input.schema_version !== undefined && input.schema_version !== SCHEMA_VERSION) {
    problems.push(`"schema_version" must be ${SCHEMA_VERSION} (or omitted).`);
  }

  const account = input.account;
  if (account !== "paper" && account !== "live") {
    problems.push('"account" must be "paper" or "live".');
  }

  const num = (key: string, opts: { required: boolean; min?: number; max?: number; exclusiveMin?: boolean }): number => {
    const v = input[key];
    if (v === undefined || v === null) {
      if (opts.required) problems.push(`"${key}" is required (a number).`);
      return 0;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      problems.push(`"${key}" must be a finite number, got ${JSON.stringify(v)}.`);
      return 0;
    }
    if (opts.min !== undefined && (opts.exclusiveMin ? v <= opts.min : v < opts.min)) {
      problems.push(`"${key}" must be ${opts.exclusiveMin ? ">" : ">="} ${opts.min}, got ${v}.`);
    }
    if (opts.max !== undefined && v > opts.max) {
      problems.push(`"${key}" must be <= ${opts.max}, got ${v}.`);
    }
    return v;
  };

  // Percentages are percent, not fractions: 1.25 means +1.25%.
  const equity = num("equity", { required: true, min: 0, max: 1e9, exclusiveMin: true });
  const totalReturn = num("total_return_pct", { required: true, min: -100, max: 100000 });
  const netDeposits = num("net_deposits", { required: false, min: -1e9, max: 1e9 });

  if (type === "snapshot") {
    if (problems.length > 0) return { ok: false, problems };
    return {
      ok: true,
      report: {
        type,
        account: account as Account,
        equity,
        total_return_pct: totalReturn,
        net_deposits: netDeposits,
      },
    };
  }

  const dayReturn = num("day_return_pct", { required: true, min: -100, max: 100000 });
  const benchReturn = num("benchmark_return_pct", { required: true, min: -100, max: 100000 });

  const dateStr = typeof input.date === "string" ? input.date : "";
  const date = parseDate(dateStr);
  if (!date) {
    problems.push('"date" is required, as "YYYY-MM-DD".');
  } else if (date.getTime() > now.getTime() + 24 * 3600 * 1000) {
    problems.push(`"date" ${dateStr} is in the future.`);
  }

  const sinceStr = typeof input.tracking_since === "string" ? input.tracking_since : "";
  const since = parseDate(sinceStr);
  if (!since) {
    problems.push('"tracking_since" is required, as "YYYY-MM-DD" (the day you started tracking this account).');
  } else if (date && since.getTime() > date.getTime()) {
    problems.push('"tracking_since" can\'t be after "date".');
  }

  let benchmark = "SPY";
  if (input.benchmark !== undefined) {
    if (typeof input.benchmark !== "string" || !/^[A-Z.]{1,10}$/.test(input.benchmark)) {
      problems.push('"benchmark" must be a ticker like "SPY".');
    } else {
      benchmark = input.benchmark;
    }
  }

  let strategy: string | null = null;
  if (input.strategy !== undefined && input.strategy !== null) {
    if (typeof input.strategy !== "string" || input.strategy.length > 80) {
      problems.push('"strategy" must be a string of at most 80 characters.');
    } else {
      strategy = input.strategy;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    report: {
      type,
      account: account as Account,
      date: dateStr,
      equity,
      net_deposits: netDeposits,
      day_return_pct: dayReturn,
      total_return_pct: totalReturn,
      benchmark,
      benchmark_return_pct: benchReturn,
      strategy,
      tracking_since: sinceStr,
    },
  };
}
