export type Account = "paper" | "live";
export type Mood = "first" | "second" | "third";

export interface Person {
  id: string;
  displayName: string;
  color: string;
  /** Displayable image URL per mood (signed URL or demo URL). Missing = emoji fallback. */
  gifs: Partial<Record<Mood, string>>;
}

export interface Season {
  id: string;
  name: string;
  startsAt: string; // ISO timestamp
  endsAt: string | null;
  startEquity: number;
}

/** One person's current numbers in one account, computed by the server. */
export interface Stats {
  personId: string;
  account: Account;
  lastSeen: string; // ISO timestamp of the newest counted report
  equity: number;
  totalReturnPct: number;
  todayPct: number; // since New York midnight
  maxDrawdownPct: number; // <= 0
  openPositions: number | null;
  settledBets: number | null;
  wonBets: number | null;
  feesPaid: number | null;
}

/** Total return at New York midnight ending `date`. */
export interface DayClose {
  personId: string;
  account: Account;
  date: string; // YYYY-MM-DD
  totalReturnPct: number;
}

/** A finished bet. Open bets are never sent to the dashboard. */
export interface SettledBet {
  personId: string;
  account: Account;
  marketSlug: string;
  marketTitle: string;
  side: string;
  stake: number;
  pnl: number;
  result: "won" | "lost" | "push";
  settledAt: string;
}

export interface Settings {
  snapshotMinutes: number;
  staleAfterMinutes: number;
}

export interface Dataset {
  people: Person[];
  season: Season;
  stats: Stats[];
  closes: DayClose[];
  bets: SettledBet[]; // newest first
  /** Latest report before the season started (connection tests, not scored). */
  checkIns: { personId: string; at: string }[];
  settings: Settings;
}

export interface DataSource {
  readonly kind: "supabase" | "demo";
  load(): Promise<Dataset>;
  /** Calls `onChange` whenever new data may be available. Returns an unsubscribe fn. */
  subscribe(onChange: () => void): () => void;
}
