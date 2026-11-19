import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { APP_NAME } from "./config";
import { demoSource } from "./lib/demoSource";
import { isDemo, supabase } from "./lib/supabase";
import { supabaseSource } from "./lib/supabaseSource";
import { Leaderboard } from "./pages/Leaderboard";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";

type View = "race" | "profile";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(isDemo);
  const [view, setView] = useState<View>("race");
  const source = useMemo(() => (supabase ? supabaseSource(supabase) : demoSource()), []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!authReady) return null;
  if (supabase && !session) return <Login sb={supabase} />;

  return (
    <>
      <header className="top">
        <h1 onClick={() => setView("race")}>🏁 {APP_NAME}</h1>
        {isDemo && <span className="demo-pill">DEMO DATA</span>}
        <nav>
          <button className={view === "race" ? "active" : ""} onClick={() => setView("race")}>
            Race
          </button>
          {supabase && session && (
            <>
              <button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>
                Profile
              </button>
              <button onClick={() => void supabase!.auth.signOut()}>Sign out</button>
            </>
          )}
        </nav>
      </header>
      {view === "profile" && supabase && session ? (
        <Profile sb={supabase} userId={session.user.id} />
      ) : (
        <Leaderboard source={source} />
      )}
    </>
  );
}
