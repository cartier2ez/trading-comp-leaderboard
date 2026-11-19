// Demo mode: three fake bots with 30 days of history and a live tick every few
// seconds, so you can watch ranks shuffle without a Supabase project.

import { loadDemoFaces } from "./faceStore";
import { etDate } from "./time";
import type { DailyRecord, DataSource, Dataset, Person, Snapshot } from "./types";

const TICK_MS = 3500;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** The last `n` weekdays strictly before today (ET). */
function pastTradingDays(n: number, now: Date): string[] {
  const days: string[] = [];
  const d = new Date(`${etDate(now)}T12:00:00Z`);
  while (days.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.unshift(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Random daily returns (in %) nudged so the path ends at `targetPct`. */
function path(rand: () => number, n: number, volPct: number, targetPct: number): number[] {
  const logs = Array.from({ length: n }, () => Math.log(1 + (gaussian(rand) * volPct) / 100));
  const fix = (Math.log(1 + targetPct / 100) - logs.reduce((a, b) => a + b, 0)) / n;
  return logs.map((l) => (Math.exp(l + fix) - 1) * 100);
}

const PEOPLE: (Person & { strategy: string; vol: number; target: number })[] = [
  { id: "demo-jon", displayName: "Jon", color: "#f97316", gifs: {}, strategy: "trend_basket_sma210", vol: 1.0, target: 3.4 },
  { id: "demo-ruben", displayName: "Ruben", color: "#3b82f6", gifs: {}, strategy: "momentum_yolo", vol: 1.6, target: 2.9 },
  { id: "demo-ian", displayName: "Ian", color: "#22c55e", gifs: {}, strategy: "mean_reversion_v2", vol: 0.8, target: 3.8 },
];

function buildHistory(now: Date): Dataset {
  const rand = mulberry32(42);
  const days = pastTradingDays(30, now);
  const spy = path(rand, days.length, 0.8, 2.2);
  const spyTotals: number[] = [];
  spy.reduce((w, r) => {
    const next = w * (1 + r / 100);
    spyTotals.push((next - 1) * 100);
    return next;
  }, 1);

  const daily: DailyRecord[] = [];
  for (const p of PEOPLE) {
    let wealth = 1;
    path(rand, days.length, p.vol, p.target).forEach((r, i) => {
      wealth *= 1 + r / 100;
      daily.push({
        personId: p.id,
        account: "paper",
        date: days[i]!,
        equity: 100000 * wealth,
        dayReturnPct: r,
        totalReturnPct: (wealth - 1) * 100,
        benchmarkReturnPct: spyTotals[i]!,
        strategy: p.strategy,
        trackingSince: days[0]!,
        receivedAt: `${days[i]}T21:20:00Z`,
      });
    });
  }

  // Jon went live 4 days ago with $500; the others haven't yet.
  const liveDays = days.slice(-4);
  const spyBase = 1 + (spyTotals[spyTotals.length - 5] ?? 0) / 100;
  let wealth = 1;
  path(rand, liveDays.length, 1.0, 0.9).forEach((r, i) => {
    wealth *= 1 + r / 100;
    daily.push({
      personId: "demo-jon",
      account: "live",
      date: liveDays[i]!,
      equity: 500 * wealth,
      dayReturnPct: r,
      totalReturnPct: (wealth - 1) * 100,
      benchmarkReturnPct: ((1 + spyTotals[spyTotals.length - 4 + i]! / 100) / spyBase - 1) * 100,
      strategy: "trend_basket_sma210",
      trackingSince: liveDays[0]!,
      receivedAt: `${liveDays[i]}T21:20:00Z`,
    });
  });

  // A few snapshots from earlier "today" so the race starts mid-session.
  const snapshots: Snapshot[] = [];
  for (const p of PEOPLE) {
    const last = daily.filter((d) => d.personId === p.id && d.account === "paper").at(-1)!;
    let total = last.totalReturnPct;
    for (let k = 5; k >= 0; k--) {
      total += gaussian(rand) * 0.3;
      snapshots.push({
        personId: p.id,
        account: "paper",
        ts: new Date(now.getTime() - k * 10 * 60 * 1000).toISOString(),
        equity: 100000 * (1 + total / 100),
        totalReturnPct: total,
      });
    }
  }

  return {
    people: PEOPLE.map(({ id, displayName, color, gifs }) => ({ id, displayName, color, gifs })),
    daily,
    snapshots,
    settings: { competitionStart: null, competitionEnd: null, snapshotMinutes: 10, staleAfterMinutes: 30 },
  };
}

export function demoSource(): DataSource {
  const state = buildHistory(new Date());
  return {
    kind: "demo",
    async load() {
      // Faces taken on the demo Profile page show on Jon's card.
      const jonFaces = await loadDemoFaces();
      const people = state.people.map((p) => (p.id === "demo-jon" ? { ...p, gifs: jonFaces } : p));
      return { ...state, people, daily: [...state.daily], snapshots: [...state.snapshots] };
    },
    subscribe(onChange) {
      const timer = setInterval(() => {
        const now = new Date().toISOString();
        for (const p of PEOPLE) {
          const last = state.snapshots.filter((s) => s.personId === p.id).at(-1);
          const total = (last?.totalReturnPct ?? 0) + gaussian(Math.random) * 0.35;
          state.snapshots.push({
            personId: p.id,
            account: "paper",
            ts: now,
            equity: 100000 * (1 + total / 100),
            totalReturnPct: total,
          });
        }
        onChange();
      }, TICK_MS);
      return () => clearInterval(timer);
    },
  };
}
