// Runs the real migrations on an in-process Postgres, then drives the real
// report handler and race_board() against it. Supabase's own schemas are stubbed.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBoard } from "../src/lib/board";
import { handleReport, type Store } from "../supabase/functions/report/handler";

const migration = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");
const JON = "00000000-0000-0000-0000-000000000001";
const IAN = "00000000-0000-0000-0000-000000000002";

const STUBS = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon, service_role;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
  -- Supabase's default privileges: RLS is what protects the tables.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

let db: PGlite;

/** Same queries as index.ts, against the local database. */
function pgStore(now: () => string): Store {
  return {
    async personForToken(hash) {
      const r = await db.query<{ person_id: string }>(
        "select person_id from bot_tokens where token_hash = $1 and revoked_at is null", [hash]);
      return r.rows[0]?.person_id ?? null;
    },
    async currentSeason() {
      const r = await db.query<{ j: never }>(
        "select to_jsonb(se) as j from settings st join seasons se on se.id = st.current_season");
      return r.rows[0]!.j;
    },
    async lastSnapshotAt(p, s, a) {
      const r = await db.query<{ ts: Date }>(
        "select ts from snapshots where person_id=$1 and season=$2 and account=$3 order by ts desc limit 1", [p, s, a]);
      return r.rows[0]?.ts.toISOString() ?? null;
    },
    async insertSnapshot(x) {
      await db.query(
        `insert into snapshots (person_id, season, account, ts, equity, open_positions, settled_bets, won_bets, fees_paid, sim_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [x.person_id, x.season, x.account, now(), x.equity, x.open_positions, x.settled_bets, x.won_bets, x.fees_paid, x.sim_version]);
      return { ts: now() };
    },
    async upsertBets(rows) {
      for (const b of rows) {
        await db.query(
          `insert into settled_bets (person_id, season, account, market_slug, side, settled_at, market_title, stake, pnl, result)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (person_id, season, account, market_slug, side, settled_at)
           do update set market_title = excluded.market_title, stake = excluded.stake, pnl = excluded.pnl, result = excluded.result`,
          [b.person_id, b.season, b.account, b.market_slug, b.side, b.settled_at, b.market_title, b.stake, b.pnl, b.result]);
      }
    },
  };
}

async function newToken(uid: string): Promise<string> {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  return (await db.query<{ t: string }>("select create_bot_token() as t")).rows[0]!.t;
}

async function post(token: string | null, body: unknown, at: string) {
  const res = await handleReport(
    new Request("http://x/report", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    pgStore(() => at),
    new Date(at),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const snap = (equity: number, extra = {}) => ({ schema_version: 2, type: "snapshot", account: "paper", equity, ...extra });
const bet = (extra = {}) => ({
  market_slug: "m", market_title: "M?", side: "Yes", stake: 50, pnl: -50, result: "lost",
  settled_at: "2026-12-02T18:00:00Z", ...extra,
});
const bets = (...list: unknown[]) => ({ schema_version: 2, type: "bets", account: "paper", bets: list });

async function board(at: string) {
  const r = await db.query<{ b: unknown }>("select race_board($1) as b", [at]);
  return parseBoard(r.rows[0]!.b);
}

let jon: string;
let ian: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(migration("20261118000000_init.sql"));
  // Production already holds stock results when v2 is applied.
  await db.exec(`
    insert into auth.users values ('${JON}', 'jon@example.com'), ('${IAN}', 'ian@example.com');
    insert into snapshots (person_id, account, ts, equity, total_return_pct) values
      ('${JON}', 'paper', '2026-11-20T15:00:00Z', 250000, 150);
    insert into daily_records (person_id, account, date, equity, day_return_pct, total_return_pct, benchmark_return_pct, tracking_since)
      values ('${JON}', 'paper', '2026-11-20', 250000, 1, 150, 0.1, '2026-11-18');
  `);
  await db.exec(migration("20261122000000_v2_polymarket.sql"));
  jon = await newToken(JON);
  ian = await newToken(IAN);
}, 30_000);

afterEach(() => db.close());

describe("migration", () => {
  it("keeps stock rows, tagged as the archived season", async () => {
    const r = await db.query("select season, equity from snapshots union all select season, equity from daily_records");
    expect(r.rows).toEqual([
      { season: "stocks-2026", equity: 250000 },
      { season: "stocks-2026", equity: 250000 },
    ]);
  });

  it("starts the season at New York midnight on Dec 1 and never shows stock results", async () => {
    const b = await board("2026-12-01T06:00:00Z");
    expect(b.season.id).toBe("polymarket-2026");
    expect(Date.parse(b.season.startsAt)).toBe(Date.parse("2026-12-01T05:00:00Z"));
    expect(b.season.startEquity).toBe(10000);
    expect(b.stats).toEqual([]);
    expect(b.checkIns).toEqual([]);
  });

  it("still lets the v1 function write (as stocks) until it's replaced", async () => {
    await db.exec(`
      insert into snapshots (person_id, account, equity, total_return_pct, net_deposits) values ('${JON}', 'paper', 1, 1, 0);
      insert into daily_records (person_id, account, date, equity, day_return_pct, total_return_pct, benchmark_return_pct, tracking_since)
        values ('${JON}', 'paper', '2026-11-20', 9, 1, 1, 1, '2026-11-18')
        on conflict (person_id, season, account, date) do update set equity = excluded.equity;
    `);
    const r = await db.query<{ season: string; equity: number }>("select season, equity from daily_records");
    expect(r.rows).toEqual([{ season: "stocks-2026", equity: 9 }]);
  });
});

describe("report endpoint", () => {
  it("rejects missing, malformed, unknown and revoked tokens", async () => {
    const at = "2026-12-02T15:00:00Z";
    expect((await post(null, snap(1), at)).status).toBe(401);
    expect((await post("tcb_nope", snap(1), at)).status).toBe(401);
    expect((await post(`tcb_${"0".repeat(64)}`, snap(1), at)).status).toBe(401);
    const old = jon;
    jon = await newToken(JON); // replaces the old one
    expect((await post(old, snap(1), at)).status).toBe(401);
    expect((await post(jon, snap(1), at)).status).toBe(200);
  });

  it("rejects v1 with 422, bad JSON with 400, huge bodies with 413, non-POST with 405", async () => {
    const at = "2026-12-02T15:00:00Z";
    const v1 = await post(jon, { type: "snapshot", account: "paper", equity: 1, total_return_pct: 0 }, at);
    expect(v1.status).toBe(422);
    expect(JSON.stringify(v1.body)).toContain("Version 1");
    expect((await post(jon, "{", at)).status).toBe(400);
    expect((await post(jon, "x".repeat(70_000), at)).status).toBe(413);
    const get = await handleReport(new Request("http://x/report"), pgStore(() => at), new Date(at));
    expect(get.status).toBe(405);
  });

  it("takes the person from the token and computes the return", async () => {
    const r = await post(jon, snap(10250), "2026-12-02T15:00:00Z");
    expect(r.body).toMatchObject({ ok: true, counts: true, season: "polymarket-2026" });
    expect(r.body.total_return_pct).toBeCloseTo(2.5);
    expect((await board("2026-12-02T16:00:00Z")).stats.map((s) => s.personId)).toEqual([JON]);
  });

  it("limits each person to one snapshot per minute", async () => {
    expect((await post(jon, snap(1), "2026-12-02T15:00:00Z")).status).toBe(200);
    expect((await post(jon, snap(2), "2026-12-02T15:00:59Z")).status).toBe(429);
    expect((await post(ian, snap(2), "2026-12-02T15:00:59Z")).status).toBe(200);
    expect((await post(jon, snap(2), "2026-12-02T15:01:00Z")).status).toBe(200);
  });

  it("keeps real money closed until a live start equity is set", async () => {
    const live = snap(500, { account: "live" });
    expect((await post(jon, live, "2026-12-02T15:00:00Z")).status).toBe(422);
    await db.exec("update seasons set live_start_equity = 400 where id = 'polymarket-2026'");
    const r = await post(jon, live, "2026-12-02T15:05:00Z");
    expect(r.body.total_return_pct).toBeCloseTo(25);
    expect((await board("2026-12-02T16:00:00Z")).stats).toMatchObject([{ account: "live", equity: 500 }]);
  });

  it("hides storage errors from the caller", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...pgStore(() => ""), personForToken: () => Promise.reject(new Error("secret detail")) };
    const req = new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${jon}` }, body: "{}" });
    const res = await handleReport(req, broken, new Date());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret detail");
    log.mockRestore();
  });
});

describe("race board", () => {
  it("treats pre-season reports as check-ins that never count", async () => {
    const r = await post(jon, snap(20000), "2026-12-01T04:59:00Z");
    expect(r.body).toMatchObject({ ok: true, counts: false });
    expect((await board("2026-12-01T04:59:30Z")).checkIns).toMatchObject([{ personId: JON }]);
    await post(jon, snap(10100), "2026-12-01T05:01:00Z");
    const b = await board("2026-12-01T05:02:00Z");
    expect(b.stats[0]!.totalReturnPct).toBeCloseTo(1);
    expect(b.stats[0]!.maxDrawdownPct).toBe(0); // the 20000 test report isn't a peak
  });

  it("lets the newest report win, including later the same day", async () => {
    await post(jon, snap(10500), "2026-12-02T15:00:00Z");
    await post(jon, snap(10200), "2026-12-02T23:00:00Z");
    expect((await board("2026-12-03T00:00:00Z")).stats[0]!.totalReturnPct).toBeCloseTo(2);
  });

  it("measures today from New York midnight, not UTC midnight", async () => {
    await post(jon, snap(10100), "2026-12-03T04:59:00Z"); // 23:59 Dec 2 in New York
    await post(jon, snap(10403), "2026-12-03T05:01:00Z"); // 00:01 Dec 3
    expect((await board("2026-12-03T06:00:00Z")).stats[0]!.todayPct).toBeCloseTo(3);
  });

  it("measures day one from the start equity", async () => {
    await post(jon, snap(10300), "2026-12-01T15:00:00Z");
    expect((await board("2026-12-01T16:00:00Z")).stats[0]!.todayPct).toBeCloseTo(3);
  });

  it("uses the last report before midnight when the bot is offline", async () => {
    await post(jon, snap(10100), "2026-12-01T20:00:00Z");
    await post(jon, snap(10400), "2026-12-04T20:00:00Z"); // silent Dec 2 and 3
    const b = await board("2026-12-05T15:00:00Z");
    expect(b.closes.map((c) => [c.date, Math.round(c.totalReturnPct * 100) / 100])).toEqual([
      ["2026-12-01", 1],
      ["2026-12-02", 1],
      ["2026-12-03", 1],
      ["2026-12-04", 4],
    ]);
    expect(b.stats[0]!.todayPct).toBeCloseTo(0); // nothing reported today
  });

  it("starts someone's closes on the day they first report", async () => {
    await post(ian, snap(9900), "2026-12-03T15:00:00Z");
    expect((await board("2026-12-05T15:00:00Z")).closes.map((c) => c.date)).toEqual(["2026-12-03", "2026-12-04"]);
  });

  it("includes intraday swings and the start equity in max drawdown", async () => {
    await post(jon, snap(9500), "2026-12-02T14:00:00Z"); // -5% from the start
    expect((await board("2026-12-02T14:30:00Z")).stats[0]!.maxDrawdownPct).toBeCloseTo(-5);
    await post(jon, snap(12000), "2026-12-02T15:00:00Z");
    await post(jon, snap(9000), "2026-12-02T16:00:00Z"); // -25% from the peak
    await post(jon, snap(12500), "2026-12-02T17:00:00Z");
    expect((await board("2026-12-03T00:00:00Z")).stats[0]!.maxDrawdownPct).toBeCloseTo(-25);
  });

  it("counts every report, and heals fully if a bad row is deleted", async () => {
    await post(jon, snap(9875), "2026-12-02T15:00:00Z");
    await post(jon, snap(8248), "2026-12-03T04:55:00Z"); // failed price lookup just before midnight
    await post(jon, snap(9875), "2026-12-03T05:05:00Z");
    const bad = await board("2026-12-03T06:00:00Z");
    expect(bad.stats[0]!.maxDrawdownPct).toBeCloseTo(-17.52);
    expect(bad.closes.at(-1)!.totalReturnPct).toBeCloseTo(-17.52);
    await db.exec("delete from snapshots where equity = 8248");
    const healed = await board("2026-12-03T06:00:00Z");
    expect(healed.stats[0]!.maxDrawdownPct).toBeCloseTo(-1.25);
    expect(healed.closes.at(-1)!.totalReturnPct).toBeCloseTo(-1.25);
    expect(healed.stats[0]!.todayPct).toBeCloseTo(0);
  });

  it("survives a bot losing everything", async () => {
    await post(jon, snap(0), "2026-12-02T15:00:00Z");
    const s = (await board("2026-12-03T15:00:00Z")).stats[0]!;
    expect(s).toMatchObject({ totalReturnPct: -100, maxDrawdownPct: -100, todayPct: 0 });
  });

  it("recomputes everything when the season's start equity or dates change", async () => {
    await post(jon, snap(10000), "2026-12-02T15:00:00Z");
    await db.exec("update seasons set start_equity = 5000 where id = 'polymarket-2026'");
    expect((await board("2026-12-02T16:00:00Z")).stats[0]!.totalReturnPct).toBeCloseTo(100);
    await db.exec("update seasons set starts_at = '2026-12-10T05:00:00Z' where id = 'polymarket-2026'");
    const b = await board("2026-12-02T16:00:00Z");
    expect(b.stats).toEqual([]);
    expect(b.checkIns).toHaveLength(1);
  });

  it("freezes when the season ends", async () => {
    await db.exec("update seasons set ends_at = '2026-12-05T05:00:00Z' where id = 'polymarket-2026'");
    await post(jon, snap(10050), "2026-12-03T15:00:00Z");
    await post(jon, snap(10100), "2026-12-04T15:00:00Z");
    const late = await post(jon, snap(99999), "2026-12-06T15:00:00Z");
    expect(late.body.counts).toBe(false);
    const b = await board("2026-12-20T15:00:00Z");
    expect(b.stats[0]!.totalReturnPct).toBeCloseTo(1);
    expect(b.closes.map((c) => c.date)).toEqual(["2026-12-03"]); // Dec 4 is the final value itself
  });
});

describe("settled bets", () => {
  const at = "2026-12-02T20:00:00Z";
  it("overwrites on resend instead of duplicating", async () => {
    await post(jon, bets(bet()), at);
    await post(jon, bets(bet({ pnl: -49, settled_at: "2026-12-02T13:00:00-05:00" })), at);
    const b = await board(at);
    expect(b.bets).toHaveLength(1);
    expect(b.bets[0]).toMatchObject({ personId: JON, pnl: -49, result: "lost" });
  });

  it("keeps two people's identical bets apart", async () => {
    await post(jon, bets(bet()), at);
    await post(ian, bets(bet()), at);
    expect((await board(at)).bets).toHaveLength(2);
  });

  it("stores pre-season bets but doesn't show them", async () => {
    const r = await post(jon, bets(bet({ settled_at: "2026-11-30T12:00:00Z" }), bet()), at);
    expect(r.body).toMatchObject({ stored: 2, shown_on_board: 1 });
    expect((await board(at)).bets).toHaveLength(1);
  });

  it("saves nothing when one bet in the batch is bad", async () => {
    const r = await post(jon, bets(bet(), bet({ side: "No", result: "open" })), at);
    expect(r.status).toBe(422);
    expect((await board(at)).bets).toEqual([]);
  });
});

describe("access rules", () => {
  const as = async (role: string, sql: string) => {
    await db.exec(`set role ${role}`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec("reset role");
    }
  };

  it("lets members read the board but write no results", async () => {
    await post(jon, snap(10100), "2026-12-02T15:00:00Z");
    const r = await as("authenticated", "select race_board('2026-12-02T16:00:00Z') as b");
    expect(parseBoard((r.rows[0] as { b: unknown }).b).stats).toHaveLength(1);
    for (const sql of [
      `insert into snapshots (person_id, account, equity) values ('${JON}', 'paper', 99999)`,
      `insert into settled_bets select * from settled_bets`,
      `insert into seasons select * from seasons`,
    ]) {
      await expect(as("authenticated", sql)).rejects.toThrow(/row-level security|permission denied/);
    }
    await expect(as("authenticated", "update seasons set start_equity = 1")).rejects.toThrow("permission denied");
  });

  it("shows anonymous visitors nothing", async () => {
    await expect(as("anon", "select race_board()")).rejects.toThrow("permission denied");
    await expect(as("anon", "select * from settled_bets")).rejects.toThrow("permission denied");
    expect((await as("anon", "select * from snapshots")).rows).toEqual([]);
  });

  it("lets the endpoint's role do exactly what it needs", async () => {
    await as("service_role", "select * from settings");
    await as("service_role", "select * from seasons");
    await as("service_role", `insert into snapshots (person_id, season, account, equity) values ('${JON}', 'polymarket-2026', 'paper', 1)`);
    await as("service_role", `insert into settled_bets values ('${JON}', 'polymarket-2026', 'paper', 'm', 'Yes', now(), 'M', 1, 1, 'won')`);
  });
});
