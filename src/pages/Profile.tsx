import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FaceSlots } from "../components/FaceSlots";
import { demoFaceStore, supabaseFaceStore } from "../lib/faceStore";
import { relativeTime } from "../lib/time";

function Toast({ msg, onClose }: { msg: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [msg]); // timer restarts only for a new message
  return msg ? (
    <p className="toast" onClick={onClose}>
      {msg}
    </p>
  ) : null;
}

export function Profile({ sb, userId }: { sb: SupabaseClient; userId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [token, setToken] = useState<{ hint: string; created: string } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const faces = useMemo(() => supabaseFaceStore(sb, userId), [sb, userId]);

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/report`;

  const loadToken = async () => {
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
    void (async () => {
      const { data } = await sb.from("profiles").select("display_name, color").eq("id", userId).single();
      if (data) {
        setName(data.display_name as string);
        setColor(data.color as string);
      }
      await loadToken();
      setLoaded(true);
    })();
  }, [sb, userId]);

  const saveBasics = async () => {
    setBusy(true);
    const { error } = await sb.from("profiles").update({ display_name: name.trim(), color }).eq("id", userId);
    setBusy(false);
    setMsg(error ? `Couldn't save: ${error.message}` : "Saved ✔");
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
    await loadToken();
  };

  if (!loaded)
    return (
      <main className="profile">
        <p className="empty">Loading profile…</p>
      </main>
    );

  return (
    <main className="profile">
      <Toast msg={msg} onClose={() => setMsg(null)} />

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
          <button onClick={() => void saveBasics()} disabled={busy || name.trim().length === 0}>
            Save
          </button>
        </div>
      </section>

      <FaceSlots store={faces} onMessage={setMsg} />

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

/** Demo mode: faces go on Jon's demo card and stay in this browser only. */
export function DemoProfile() {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <main className="profile">
      <Toast msg={msg} onClose={() => setMsg(null)} />
      <FaceSlots
        store={demoFaceStore}
        onMessage={setMsg}
        note="Demo mode: these go on Jon's demo card and stay in this browser only (nothing is uploaded)."
      />
    </main>
  );
}
