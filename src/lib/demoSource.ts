// Demo mode: three fake bots 12 days into a season, with a live tick every few
// seconds, so you can watch ranks shuffle without a Supabase project. All
// markets and results here are made up.

import { loadDemoFaces } from "./faceStore";
import { etDate } from "./time";
import type { DataSource, Dataset, DayClose, Person, SettledBet, Stats } from "./types";

const TICK_MS = 3500;
const DAYS = 12;
const START = 10_000;
const DAY_MS = 86_400_000;

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

const PEOPLE: (Person & { vol: number; target: number })[] = [
  { id: "demo-jon", displayName: "Jon", color: "#f97316", gifs: {}, vol: 1.2, target: 3.4 },
  { id: "demo-ruben", displayName: "Ruben", color: "#3b82f6", gifs: {}, vol: 1.8, target: 2.9 },
  { id: "demo-ian", displayName: "Ian", color: "#22c55e", gifs: {}, vol: 1.0, target: 3.8 },
];

const MARKETS = [
  "Will it rain in Seattle on Friday?",
  "Home team wins Saturday's game?",
  "Snow in Denver before Sunday?",
  "Total goals over 2.5 tonight?",
  "Will the launch happen this week?",
  "Highest temperature in Austin above 70°F?",
];

function fakeBet(rand: () => number, at: number): SettledBet {
  const person = PEOPLE[Math.floor(rand() * PEOPLE.length)]!;
  const n = Math.floor(rand() * MARKETS.length);
  const stake = Math.round(20 + rand() * 180);
  const roll = rand();
  const result = roll < 0.5 ? "won" : roll < 0.95 ? "lost" : "push";
  return {
    personId: person.id,
    account: "paper",
    marketSlug: `demo-market-${n}`,
    marketTitle: MARKETS[n]!,
    side: rand() < 0.5 ? "Yes" : "No",
    stake,
    pnl: result === "won" ? Math.round(stake * (0.4 + rand())) : result === "lost" ? -stake : 0,
    result,
    settledAt: new Date(at).toISOString(),
  };
}

export function demoSource(): DataSource {
  const rand = mulberry32(42);
  const now = Date.now();
  const closes: DayClose[] = [];
  const peaks = new Map<string, number>();
  const stats: Stats[] = PEOPLE.map((p) => {
    const logs = Array.from({ length: DAYS }, () => (gaussian(rand) * p.vol) / 100);
    const fix = (Math.log(1 + p.target / 100) - logs.reduce((a, b) => a + b, 0)) / DAYS;
    let wealth = 1;
    let peak = 1;
    let dd = 0;
    logs.forEach((l, i) => {
      wealth *= Math.exp(l + fix);
      peak = Math.max(peak, wealth);
      dd = Math.min(dd, wealth / peak - 1);
      closes.push({
        personId: p.id,
        account: "paper",
        date: etDate(new Date(now - (DAYS - i) * DAY_MS)),
        totalReturnPct: (wealth - 1) * 100,
      });
    });
    peaks.set(p.id, peak);
    const settled = 20 + Math.floor(rand() * 30);
    return {
      personId: p.id,
      account: "paper",
      lastSeen: new Date(now).toISOString(),
      equity: START * wealth,
      totalReturnPct: (wealth - 1) * 100,
      todayPct: 0,
      maxDrawdownPct: dd * 100,
      openPositions: 2 + Math.floor(rand() * 6),
      settledBets: settled,
      wonBets: Math.round(settled * (0.42 + rand() * 0.2)),
      feesPaid: 10 + rand() * 30,
    };
  });
  let bets = Array.from({ length: 8 }, (_, i) => fakeBet(rand, now - (i + 1) * 47 * 60_000));
  const startsAt = new Date(now - DAYS * DAY_MS).toISOString();
  const lastClose = new Map(PEOPLE.map((p) => [p.id, closes.filter((c) => c.personId === p.id).at(-1)!.totalReturnPct]));

  const tick = () => {
    for (const s of stats) {
      const total = s.totalReturnPct + gaussian(Math.random) * 0.35;
      const wealth = 1 + total / 100;
      const peak = Math.max(peaks.get(s.personId)!, wealth);
      peaks.set(s.personId, peak);
      s.totalReturnPct = total;
      s.equity = START * wealth;
      s.todayPct = (wealth / (1 + lastClose.get(s.personId)! / 100) - 1) * 100;
      s.maxDrawdownPct = Math.min(s.maxDrawdownPct, (wealth / peak - 1) * 100);
      s.lastSeen = new Date().toISOString();
    }
    if (Math.random() < 0.3) {
      const bet = fakeBet(Math.random, Date.now());
      bets = [bet, ...bets].slice(0, 30);
      const s = stats.find((x) => x.personId === bet.personId)!;
      s.settledBets = (s.settledBets ?? 0) + 1;
      if (bet.result === "won") s.wonBets = (s.wonBets ?? 0) + 1;
    }
  };

  return {
    kind: "demo",
    async load(): Promise<Dataset> {
      // Faces taken on the demo Profile page show on Jon's card.
      const jonFaces = await loadDemoFaces();
      return {
        people: PEOPLE.map(({ id, displayName, color }) => ({
          id,
          displayName,
          color,
          gifs: id === "demo-jon" ? jonFaces : {},
        })),
        season: { id: "demo", name: "Polymarket", startsAt, endsAt: null, startEquity: START },
        stats: stats.map((s) => ({ ...s })),
        closes,
        bets,
        checkIns: [],
        settings: { snapshotMinutes: 10, staleAfterMinutes: 45 },
      };
    },
    subscribe(onChange) {
      const timer = setInterval(() => {
        tick();
        onChange();
      }, TICK_MS);
      return () => clearInterval(timer);
    },
  };
}
