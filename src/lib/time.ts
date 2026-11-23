import type { Season } from "./types";

const ET = "America/New_York";

/** Calendar date (YYYY-MM-DD) of an instant, in New York time. */
export function etDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Dec 1, 12:00 AM EST" */
export function etDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export type SeasonPhase = "before" | "running" | "over";

export function seasonPhase(season: Season, now: Date): SeasonPhase {
  if (now.getTime() < Date.parse(season.startsAt)) return "before";
  if (season.endsAt !== null && now.getTime() >= Date.parse(season.endsAt)) return "over";
  return "running";
}

/** "8 days", "5 h", "12 min" until an instant. */
export function timeUntil(iso: string, now: Date): string {
  const m = Math.max(1, Math.ceil((Date.parse(iso) - now.getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.ceil(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.ceil(h / 24)} days`;
}

export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** No report for too long while the season is running (bets run 24/7). */
export function isStale(lastSeen: string | null, season: Season, staleAfterMinutes: number, now: Date): boolean {
  if (lastSeen === null || seasonPhase(season, now) !== "running") return false;
  return now.getTime() - Date.parse(lastSeen) > staleAfterMinutes * 60_000;
}
