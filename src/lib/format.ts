import type { Stats } from "./types";

export function fmtPct(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "–";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(n) < 10000 ? 2 : 0 });
}

export function tone(n: number | null): "up" | "down" | "flat" {
  if (n === null || Math.abs(n) < 0.005) return "flat";
  return n > 0 ? "up" : "down";
}

/** "14 settled · 57% won · 3 open · $12.40 fees", from whatever the bot sends. */
export function betRecord(s: Stats): string | null {
  const parts: string[] = [];
  if (s.settledBets !== null) parts.push(`${s.settledBets} settled`);
  if (s.settledBets && s.wonBets !== null) parts.push(`${Math.round((s.wonBets / s.settledBets) * 100)}% won`);
  if (s.openPositions !== null) parts.push(`${s.openPositions} open`);
  if (s.feesPaid !== null) parts.push(`${fmtMoney(s.feesPaid)} fees`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
