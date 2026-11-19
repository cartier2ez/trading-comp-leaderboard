import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_POLL_MS } from "../config";
import type { Account, DailyRecord, DataSource, Dataset, Mood, Person, Settings, Snapshot } from "./types";

const PAGE = 1000; // PostgREST's default max rows per request
const SNAPSHOT_DAYS = 4; // only recent snapshots matter for the live race
const SIGNED_URL_SECONDS = 3600;

interface ProfileRow {
  id: string;
  display_name: string;
  color: string;
  gif_first: string | null;
  gif_second: string | null;
  gif_third: string | null;
}

interface DailyRow {
  person_id: string;
  account: Account;
  date: string;
  equity: number;
  day_return_pct: number;
  total_return_pct: number;
  benchmark_return_pct: number;
  strategy: string | null;
  tracking_since: string;
  received_at: string;
}

interface SnapshotRow {
  person_id: string;
  account: Account;
  ts: string;
  equity: number;
  total_return_pct: number;
}

// Signed URLs are cached so GIFs don't re-download on every refresh.
const signedCache = new Map<string, { url: string; expires: number }>();

async function signedUrls(sb: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const missing = paths.filter((p) => (signedCache.get(p)?.expires ?? 0) < now + 5 * 60 * 1000);
  if (missing.length > 0) {
    const { data } = await sb.storage.from("gifs").createSignedUrls(missing, SIGNED_URL_SECONDS);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        signedCache.set(item.path, { url: item.signedUrl, expires: now + SIGNED_URL_SECONDS * 1000 });
      }
    }
  }
  return new Map(paths.flatMap((p) => (signedCache.has(p) ? [[p, signedCache.get(p)!.url] as const] : [])));
}

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export function supabaseSource(sb: SupabaseClient): DataSource {
  return {
    kind: "supabase",

    async load(): Promise<Dataset> {
      const since = new Date(Date.now() - SNAPSHOT_DAYS * 86400 * 1000).toISOString();
      const [profiles, daily, snapshots, settingsRes] = await Promise.all([
        fetchAll<ProfileRow>((a, b) =>
          sb.from("profiles").select("id, display_name, color, gif_first, gif_second, gif_third").order("created_at").range(a, b),
        ),
        fetchAll<DailyRow>((a, b) =>
          sb
            .from("daily_records")
            .select("person_id, account, date, equity, day_return_pct, total_return_pct, benchmark_return_pct, strategy, tracking_since, received_at")
            .order("date")
            .order("person_id")
            .range(a, b),
        ),
        fetchAll<SnapshotRow>((a, b) =>
          sb
            .from("snapshots")
            .select("person_id, account, ts, equity, total_return_pct")
            .gte("ts", since)
            .order("ts")
            .range(a, b),
        ),
        sb.from("settings").select("*").maybeSingle(),
      ]);

      const gifPaths = profiles.flatMap((p) => [p.gif_first, p.gif_second, p.gif_third].filter((x): x is string => !!x));
      const urls = await signedUrls(sb, gifPaths);
      const gif = (path: string | null) => (path ? urls.get(path) : undefined);

      const people: Person[] = profiles.map((p) => {
        const gifs: Partial<Record<Mood, string>> = {};
        const first = gif(p.gif_first);
        const second = gif(p.gif_second);
        const third = gif(p.gif_third);
        if (first) gifs.first = first;
        if (second) gifs.second = second;
        if (third) gifs.third = third;
        return { id: p.id, displayName: p.display_name, color: p.color, gifs };
      });

      const s = settingsRes.data as Record<string, unknown> | null;
      const settings: Settings = {
        competitionStart: (s?.competition_start as string | null) ?? null,
        competitionEnd: (s?.competition_end as string | null) ?? null,
        snapshotMinutes: (s?.snapshot_minutes as number | undefined) ?? 10,
        staleAfterMinutes: (s?.stale_after_minutes as number | undefined) ?? 30,
      };

      return {
        people,
        settings,
        daily: daily.map(
          (d): DailyRecord => ({
            personId: d.person_id,
            account: d.account,
            date: d.date,
            equity: d.equity,
            dayReturnPct: d.day_return_pct,
            totalReturnPct: d.total_return_pct,
            benchmarkReturnPct: d.benchmark_return_pct,
            strategy: d.strategy,
            trackingSince: d.tracking_since,
            receivedAt: d.received_at,
          }),
        ),
        snapshots: snapshots.map(
          (r): Snapshot => ({
            personId: r.person_id,
            account: r.account,
            ts: r.ts,
            equity: r.equity,
            totalReturnPct: r.total_return_pct,
          }),
        ),
      };
    },

    subscribe(onChange) {
      const channel = sb
        .channel("race")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "snapshots" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "daily_records" }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, onChange)
        .subscribe();
      // Safety net in case the realtime connection silently drops.
      const poll = setInterval(onChange, FALLBACK_POLL_MS);
      return () => {
        clearInterval(poll);
        void sb.removeChannel(channel);
      };
    },
  };
}
