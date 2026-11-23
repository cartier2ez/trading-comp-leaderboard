// POST /functions/v1/report: the only way results get into the dashboard.
//
// Auth: `Authorization: Bearer tcb_...` (a bot token from the profile page).
// Who the report belongs to comes from the token, never from the body.
// Body: a snapshot or a list of settled bets, see validate.ts / BOT_GUIDE.md.
//
// This file only connects storage; the logic is in handler.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleReport, type SeasonInfo, type Store } from "./handler.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

const store: Store = {
  async personForToken(tokenHash) {
    const { data, error } = await supabase
      .from("bot_tokens")
      .select("person_id")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    check(error);
    return data ? (data.person_id as string) : null;
  },

  async currentSeason() {
    const settings = await supabase.from("settings").select("current_season").single();
    check(settings.error);
    const { data, error } = await supabase
      .from("seasons")
      .select("id, starts_at, ends_at, start_equity, live_start_equity")
      .eq("id", settings.data!.current_season)
      .single();
    check(error);
    return data as SeasonInfo;
  },

  async lastSnapshotAt(personId, season, account) {
    const { data, error } = await supabase
      .from("snapshots")
      .select("ts")
      .eq("person_id", personId)
      .eq("season", season)
      .eq("account", account)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    check(error);
    return data ? (data.ts as string) : null;
  },

  async insertSnapshot(row) {
    const { data, error } = await supabase.from("snapshots").insert(row).select("ts").single();
    check(error);
    return { ts: data!.ts as string };
  },

  async upsertBets(rows) {
    const { error } = await supabase
      .from("settled_bets")
      .upsert(rows, { onConflict: "person_id,season,account,market_slug,side,settled_at" });
    check(error);
  },
};

Deno.serve((req) => handleReport(req, store, new Date()));
