// Request handling for the `report` endpoint, with storage passed in so tests
// can run it against a local Postgres. No Deno APIs here; see index.ts.

import { validateReport, type Account, type SettledBet, type SnapshotReport } from "./validate.ts";

export interface SeasonInfo {
  id: string;
  starts_at: string;
  ends_at: string | null;
  start_equity: number;
  live_start_equity: number | null;
}

export type SnapshotRow = Omit<SnapshotReport, "type"> & { person_id: string; season: string };
export type BetRow = SettledBet & { person_id: string; season: string; account: Account };

/** Every method throws on a storage failure. */
export interface Store {
  personForToken(tokenHash: string): Promise<string | null>;
  currentSeason(): Promise<SeasonInfo>;
  lastSnapshotAt(personId: string, season: string, account: Account): Promise<string | null>;
  insertSnapshot(row: SnapshotRow): Promise<{ ts: string }>;
  upsertBets(rows: BetRow[]): Promise<void>;
}

// A bot looping by mistake shouldn't flood the table.
export const MIN_SECONDS_BETWEEN_SNAPSHOTS = 60;
const MAX_BODY_CHARS = 64 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function inSeason(s: SeasonInfo, at: number): boolean {
  return at >= Date.parse(s.starts_at) && (s.ends_at === null || at < Date.parse(s.ends_at));
}

export async function handleReport(req: Request, store: Store, now: Date): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "Use POST with a JSON body." });

  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(tcb_[0-9a-f]{64})$/);
  if (!match) {
    return json(401, {
      error:
        "Missing or malformed bot token. Send header `Authorization: Bearer tcb_...` " +
        "with the token from your profile page.",
    });
  }

  try {
    const personId = await store.personForToken(await sha256Hex(match[1]!));
    if (!personId) {
      return json(401, { error: "Unknown or revoked bot token. Generate a new one on your profile page." });
    }

    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return json(413, { error: "Body is too large (64 KB max)." });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "Body must be valid JSON." });
    }

    const result = validateReport(body, now);
    if (!result.ok) return json(422, { error: "Invalid report.", problems: result.problems });
    const report = result.report;

    const season = await store.currentSeason();
    if (report.account === "live" && season.live_start_equity === null) {
      return json(422, { error: "Invalid report.", problems: ['Real money isn\'t open yet. Use "account": "paper".'] });
    }

    if (report.type === "bets") {
      await store.upsertBets(
        report.bets.map((b) => ({ ...b, person_id: personId, season: season.id, account: report.account })),
      );
      const counted = report.bets.filter((b) => inSeason(season, Date.parse(b.settled_at))).length;
      return json(200, { ok: true, season: season.id, stored: report.bets.length, shown_on_board: counted });
    }

    const last = await store.lastSnapshotAt(personId, season.id, report.account);
    if (last && now.getTime() - Date.parse(last) < MIN_SECONDS_BETWEEN_SNAPSHOTS * 1000) {
      return json(429, {
        error:
          `At most one snapshot per ${MIN_SECONDS_BETWEEN_SNAPSHOTS}s. ` +
          "Harmless after a retry: your previous snapshot was saved.",
      });
    }
    const { type: _type, ...fields } = report;
    const { ts } = await store.insertSnapshot({ ...fields, person_id: personId, season: season.id });
    const start = report.account === "live" ? season.live_start_equity! : season.start_equity;
    const counts = inSeason(season, Date.parse(ts));
    return json(200, {
      ok: true,
      season: season.id,
      ts,
      equity: report.equity,
      total_return_pct: (report.equity / start - 1) * 100,
      counts,
      ...(counts ? {} : { note: `Outside the season (starts ${season.starts_at}): saved as a check-in, not scored.` }),
    });
  } catch (e) {
    // Details go to the function log only, never to the caller.
    console.error("report failed:", e instanceof Error ? e.message : e);
    return json(500, { error: "The server couldn't process the report. Try again." });
  }
}
