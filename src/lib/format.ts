export function fmtPct(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return "–";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtMoney(n: number | null): string {
  if (n === null) return "–";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10000 ? 2 : 0 });
}

export function tone(n: number | null): "up" | "down" | "flat" {
  if (n === null || Math.abs(n) < 0.005) return "flat";
  return n > 0 ? "up" : "down";
}
