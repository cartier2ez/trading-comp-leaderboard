// Fun copy and display knobs. Edit freely.
import type { Mood } from "./lib/types";

export const APP_NAME = "Bot Race";

export const MOOD_EMOJI: Record<Mood, string> = { first: "😁", second: "😐", third: "😭" };

export const MOOD_TAGLINE: Record<Mood, string> = {
  first: "Main character energy",
  second: "Mid. Perfectly mid.",
  third: "Down bad",
};

export const RANK_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export const OVERTAKE_LINES = [
  "🚀 {passer} just overtook {passed}!",
  "😤 {passer} blows past {passed}",
  "👋 See ya, {passed}. {passer} moves up",
  "🔥 {passer} passes {passed}. Drama.",
];

export const RULES_NOTE =
  "Ranked by total % return. SPY is a reference line (did the bot beat doing nothing?), not a competitor.";

/** How long the page waits without realtime events before re-fetching anyway. */
export const FALLBACK_POLL_MS = 5 * 60 * 1000;

/** What the camera screen tells you to do for each rank face. */
export const MOOD_PROMPT: Record<Mood, string> = {
  first: "1st place: smile big! 😁",
  second: "2nd place: straight face 😐",
  third: "3rd place: cry it out 😭",
};
