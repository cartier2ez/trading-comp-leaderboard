import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BetList } from "../components/BetList";
import { OvertakeBanner, overtakeText } from "../components/OvertakeBanner";
import { PodiumCard } from "../components/PodiumCard";
import { RaceChart } from "../components/RaceChart";
import { RULES_NOTE } from "../config";
import { raceRows } from "../lib/chart";
import { fmtMoney } from "../lib/format";
import { detectOvertakes } from "../lib/overtakes";
import { computeStandings, type Standing } from "../lib/ranking";
import { etDateTime, isStale, relativeTime, seasonPhase, timeUntil } from "../lib/time";
import type { Account, DataSource, Dataset } from "../lib/types";
import { useFlip } from "../lib/useFlip";

const TABS: { id: Account; label: string }[] = [
  { id: "paper", label: "🎲 Simulation" },
  { id: "live", label: "💸 Real money" },
];

function initialTab(): Account {
  try {
    return localStorage.getItem("tab") === "live" ? "live" : "paper";
  } catch {
    return "paper";
  }
}

export function Leaderboard({ source }: { source: DataSource }) {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<Account>(initialTab);
  const [now, setNow] = useState(() => new Date());
  const [banners, setBanners] = useState<{ id: string; text: string }[]>([]);

  // Load once, then reload (debounced) whenever the source says data changed.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      source
        .load()
        .then((d) => {
          if (!alive) return;
          setDs(d);
          setError(null);
          setUpdatedAt(new Date().toISOString());
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    };
    reload();
    const unsubscribe = source.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(reload, 600);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [source]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);

  const pickTab = (a: Account) => {
    setTab(a);
    try {
      localStorage.setItem("tab", a);
    } catch {
      /* private mode etc. */
    }
  };

  // The real-money tab stays hidden until someone goes live.
  const anyoneLive = ds?.stats.some((s) => s.account === "live") ?? false;
  const account: Account = anyoneLive ? tab : "paper";

  const standings = useMemo(() => (ds ? computeStandings(ds, account) : []), [ds, account]);
  const ranked = standings.filter((s) => s.rank !== null);
  const waiting = standings.filter((s) => s.rank === null);

  // Overtake banners: compare with the previous ranking of the same tab.
  const prev = useRef(new Map<Account, Standing[]>());
  useEffect(() => {
    if (!ds) return;
    const before = prev.current.get(account);
    if (before) {
      const fresh = detectOvertakes(before, standings).map((o) => ({ id: o.id, text: overtakeText(o) }));
      if (fresh.length > 0) setBanners((b) => [...b, ...fresh].slice(-5));
    }
    prev.current.set(account, standings);
  }, [ds, account, standings]);
  const dismiss = useCallback((id: string) => setBanners((b) => b.filter((x) => x.id !== id)), []);

  const flipRef = useFlip(ranked.map((s) => s.person.id));
  const rows = useMemo(() => (ds ? raceRows(ds, account, standings) : []), [ds, account, standings]);
  const phase = ds ? seasonPhase(ds.season, now) : null;

  return (
    <main className="board">
      <div className="board-head">
        {anyoneLive && (
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={account === t.id}
                className={account === t.id ? "active" : ""}
                onClick={() => pickTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
        {ds && (
          <span className={`live-pill ${phase === "running" ? "on" : ""}`}>
            <span className="dot" />
            {ds.season.name}{" "}
            {phase === "before" ? `starts in ${timeUntil(ds.season.startsAt, now)}` : phase === "over" ? "· final" : "· live 24/7"}
            {updatedAt && <span className="muted"> · updated {relativeTime(updatedAt, now)}</span>}
          </span>
        )}
      </div>

      <OvertakeBanner items={banners} onDone={dismiss} />

      {error && <p className="error">Couldn't load the race: {error}</p>}
      {!ds && !error && <p className="empty">Loading the race…</p>}

      {ds && ranked.length === 0 && (
        <section className="empty">
          <p className="big">🏁</p>
          {phase === "before" ? (
            <>
              <p>
                {ds.season.name} starts {etDateTime(ds.season.startsAt)} with {fmtMoney(ds.season.startEquity)} each.
              </p>
              <p className="muted">
                Bots connected:{" "}
                {ds.people
                  .map((p) => `${p.displayName} ${ds.checkIns.some((c) => c.personId === p.id) ? "✅" : "—"}`)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <>
              <p>No bot has reported yet.</p>
              <p className="muted">Generate a bot token on your profile page and follow BOT_GUIDE.md.</p>
            </>
          )}
        </section>
      )}

      {ranked.length > 0 && (
        <section className="podium">
          {ranked.map(
            (s) =>
              s.stats && (
                <PodiumCard
                  key={s.person.id}
                  cardRef={flipRef(s.person.id)}
                  standing={s}
                  stats={s.stats}
                  now={now}
                  stale={isStale(s.stats.lastSeen, ds!.season, ds!.settings.staleAfterMinutes, now)}
                  rows={rows}
                />
              ),
          )}
        </section>
      )}

      {waiting.length > 0 && ranked.length > 0 && (
        <p className="waiting">
          {account === "live" ? "Still in simulation: " : "No report yet: "}
          {waiting.map((s) => s.person.displayName).join(", ")}
        </p>
      )}

      {ranked.length > 0 && (
        <section className="panel">
          <h3>The race · total % return</h3>
          <RaceChart rows={rows} people={ranked.map((s) => s.person)} />
        </section>
      )}

      {ds && ranked.length > 0 && (
        <section className="panel">
          <h3>Latest settled bets</h3>
          <BetList bets={ds.bets.filter((b) => b.account === account)} people={ds.people} now={now} />
        </section>
      )}

      <p className="rules muted">{RULES_NOTE}</p>
    </main>
  );
}
