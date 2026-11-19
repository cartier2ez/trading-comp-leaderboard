import { useEffect, useState, type ChangeEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MOOD_EMOJI } from "../config";
import { relativeTime } from "../lib/time";
import type { Mood } from "../lib/types";

const SLOTS: { mood: Mood; column: "gif_first" | "gif_second" | "gif_third"; label: string }[] = [
  { mood: "first", column: "gif_first", label: "1st place (smiling)" },
  { mood: "second", column: "gif_second", label: "2nd place (straight face)" },
  { mood: "third", column: "gif_third", label: "3rd place (crying)" },
];

interface ProfileRow {
  display_name: string;
  color: string;
  gif_first: string | null;
  gif_second: string | null;
  gif_third: string | null;
}

export function Profile({ sb, userId }: { sb: SupabaseClient; userId: string }) {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<Mood, string>>>({});
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [token, setToken] = useState<{ hint: string; created: string } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/report`;

  const load = async () => {
    const { data } = await sb
      .from("profiles")
      .select("display_name, color, gif_first, gif_second, gif_third")
      .eq("id", userId)
      .single<ProfileRow>();
    if (!data) return;
    setProfile(data);
    setName(data.display_name);
    setColor(data.color);
    const next: Partial<Record<Mood, string>> = {};
    for (const s of SLOTS) {
      const path = data[s.column];
      if (path) {
        const { data: signed } = await sb.storage.from("gifs").createSignedUrl(path, 3600);
        if (signed) next[s.mood] = signed.signedUrl;
      }
    }
    setPreviews(next);
    const { data: tok } = await sb
      .from("bot_tokens")
      .select("token_hint, created_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setToken(tok ? { hint: tok.token_hint as string, created: tok.created_at as string } : null);
  };

  useEffect(() => {
    void load();
  }, [userId]);

  const saveBasics = async () => {
    setBusy(true);
    const { error } = await sb.from("profiles").update({ display_name: name.trim(), color }).eq("id", userId);
    setBusy(false);
    setMsg(error ? `Couldn't save: ${error.message}` : "Saved ✔");
  };

  const upload = async (slot: (typeof SLOTS)[number], e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !profile) return;
    if (file.size > 8 * 1024 * 1024) {
      setMsg("That file is over 8 MB. Try a smaller GIF.");
      return;
    }
    setBusy(true);
    const ext = (file.name.split(".").pop() ?? "gif").toLowerCase().replace(/[^a-z0-9]/g, "");
    // A new filename each time, so browsers never show a cached old GIF.
    const path = `${userId}/${slot.mood}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("gifs").upload(path, file, { contentType: file.type });
    if (error) {
      setBusy(false);
      setMsg(`Upload failed: ${error.message}`);
      return;
    }
    const old = profile[slot.column];
    await sb.from("profiles").update({ [slot.column]: path }).eq("id", userId);
    if (old) await sb.storage.from("gifs").remove([old]);
    setBusy(false);
    setMsg(`${slot.label} updated ✔`);
    await load();
  };

  const generateToken = async () => {
    if (token && !window.confirm("This replaces your current token. Your bot stops reporting until you update its .env. Continue?")) {
      return;
    }
    setBusy(true);
    const { data, error } = await sb.rpc("create_bot_token");
    setBusy(false);
    if (error) {
      setMsg(`Couldn't create a token: ${error.message}`);
      return;
    }
    setNewToken(data as string);
    await load();
  };

  if (!profile) return <main className="profile"><p className="empty">Loading profile…</p></main>;

  return (
    <main className="profile">
      {msg && (
        <p className="toast" onClick={() => setMsg(null)}>
          {msg}
        </p>
      )}

      <section className="panel">
        <h3>You</h3>
        <div className="row">
          <label>
            Display name
            <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <button onClick={saveBasics} disabled={busy || name.trim().length === 0}>
            Save
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Your rank faces</h3>
        <p className="muted">GIF, PNG, JPG or WebP, up to 8 MB. Everyone in the race sees these.</p>
        <div className="slots">
          {SLOTS.map((s) => (
            <label key={s.mood} className="slot">
              <div className="face small">
                {previews[s.mood] ? <img src={previews[s.mood]} alt={s.label} /> : <span>{MOOD_EMOJI[s.mood]}</span>}
              </div>
              <span>{s.label}</span>
              <input type="file" accept="image/gif,image/png,image/jpeg,image/webp" onChange={(e) => void upload(s, e)} disabled={busy} />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Bot token</h3>
        <p className="muted">
          Your bot sends results with this token. Put it in your bot's <code>.env</code>, never in code or git. See
          BOT_GUIDE.md.
        </p>
        <p>
          Endpoint: <code>{endpoint}</code>
        </p>
        {token ? (
          <p>
            Active token: <code>tcb_…{token.hint}</code>, created {relativeTime(token.created, new Date())}
          </p>
        ) : (
          <p>No token yet.</p>
        )}
        {newToken && (
          <div className="secret">
            <p>
              <strong>Copy this now. It won't be shown again.</strong>
            </p>
            <code>{newToken}</code>
            <button onClick={() => void navigator.clipboard.writeText(newToken).then(() => setMsg("Copied ✔"))}>Copy</button>
          </div>
        )}
        <button onClick={() => void generateToken()} disabled={busy}>
          {token ? "Replace token" : "Generate token"}
        </button>
      </section>
    </main>
  );
}
