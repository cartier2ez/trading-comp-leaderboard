// POST /functions/v1/report — the only way results get into the dashboard.
//
// Auth: `Authorization: Bearer tcb_...` (a bot token from the profile page).
// Who the report belongs to comes from the token, never from the body.
// Body: a snapshot or daily record, see validate.ts / BOT_GUIDE.md.
//
// Deploy: supabase functions deploy report --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { validateReport } from "./validate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// A bot looping by mistake shouldn't flood the table.
const MIN_SECONDS_BETWEEN_SNAPSHOTS = 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Use POST with a JSON body." });
  }

  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(tcb_[0-9a-f]{64})$/);
  if (!match) {
    return json(401, {
      error: "Missing or malformed bot token. Send header `Authorization: Bearer tcb_...` " +
        "with the token from your profile page.",
    });
  }

  const { data: token, error: tokenError } = await supabase
    .from("bot_tokens")
    .select("person_id")
    .eq("token_hash", await sha256Hex(match[1]!))
    .is("revoked_at", null)
    .maybeSingle();
  if (tokenError) return json(500, { error: "Token lookup failed, try again." });
  if (!token) {
    return json(401, { error: "Unknown or revoked bot token. Generate a new one on your profile page." });
  }
  const personId: string = token.person_id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Body must be valid JSON." });
  }

  const result = validateReport(body, new Date());
  if (!result.ok) {
    return json(422, { error: "Invalid report.", problems: result.problems });
  }
  const { type, ...fields } = result.report;

  if (type === "snapshot") {
    const { data: last } = await supabase
      .from("snapshots")
      .select("ts")
      .eq("person_id", personId)
      .eq("account", fields.account)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && Date.now() - new Date(last.ts).getTime() < MIN_SECONDS_BETWEEN_SNAPSHOTS * 1000) {
      return json(429, { error: `Too many snapshots: at most one per ${MIN_SECONDS_BETWEEN_SNAPSHOTS}s.` });
    }
    const { data, error } = await supabase
      .from("snapshots")
      .insert({ person_id: personId, ...fields })
      .select("account, ts, equity, total_return_pct")
      .single();
    if (error) return json(500, { error: "Could not save snapshot.", detail: error.message });
    return json(200, { ok: true, stored: { type, ...data } });
  }

  const { data, error } = await supabase
    .from("daily_records")
    .upsert({ person_id: personId, ...fields, received_at: new Date().toISOString() })
    .select("account, date, equity, total_return_pct")
    .single();
  if (error) return json(500, { error: "Could not save daily record.", detail: error.message });
  return json(200, { ok: true, stored: { type, ...data } });
});
