import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_NAME } from "../config";

export function Login({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      // Invite-only: never create accounts from the login form.
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error) {
      setState("idle");
      setError(
        /signups? not allowed|not found/i.test(error.message)
          ? "That email isn't on the invite list. Ask Jon to invite you."
          : error.message,
      );
    } else {
      setState("sent");
    }
  };

  return (
    <main className="login">
      <div className="login-card">
        <p className="big">🏁</p>
        <h1>{APP_NAME}</h1>
        <p className="muted">Jon vs Ruben vs Ian. Highest % return wins.</p>
        {state === "sent" ? (
          <p className="sent">📬 Check your email for the magic link.</p>
        ) : (
          <form onSubmit={submit}>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
