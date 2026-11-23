import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_POLL_MS } from "../config";
import { parseBoard } from "./board";
import type { DataSource, Dataset, Mood, Person } from "./types";

const SIGNED_URL_SECONDS = 3600;

interface ProfileRow {
  id: string;
  display_name: string;
  color: string;
  gif_first: string | null;
  gif_second: string | null;
  gif_third: string | null;
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

export function supabaseSource(sb: SupabaseClient): DataSource {
  return {
    kind: "supabase",

    async load(): Promise<Dataset> {
      const [profilesRes, boardRes, settingsRes] = await Promise.all([
        sb
          .from("profiles")
          .select("id, display_name, color, gif_first, gif_second, gif_third")
          .order("created_at"),
        sb.rpc("race_board"),
        sb.from("settings").select("snapshot_minutes, stale_after_minutes").maybeSingle(),
      ]);
      for (const res of [profilesRes, boardRes, settingsRes]) {
        if (res.error) throw new Error(res.error.message);
      }
      const profiles = (profilesRes.data ?? []) as ProfileRow[];

      const gifPaths = profiles.flatMap((p) => [p.gif_first, p.gif_second, p.gif_third].filter((x): x is string => !!x));
      const urls = await signedUrls(sb, gifPaths);
      const people = profiles.map((p): Person => {
        const gifs: Partial<Record<Mood, string>> = {};
        const add = (mood: Mood, path: string | null) => {
          const url = path ? urls.get(path) : undefined;
          if (url) gifs[mood] = url;
        };
        add("first", p.gif_first);
        add("second", p.gif_second);
        add("third", p.gif_third);
        return { id: p.id, displayName: p.display_name, color: p.color, gifs };
      });

      const s = settingsRes.data as { snapshot_minutes: number; stale_after_minutes: number } | null;
      return {
        people,
        ...parseBoard(boardRes.data),
        settings: { snapshotMinutes: s?.snapshot_minutes ?? 10, staleAfterMinutes: s?.stale_after_minutes ?? 45 },
      };
    },

    subscribe(onChange) {
      const channel = sb
        .channel("race")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "snapshots" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "settled_bets" }, onChange)
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
