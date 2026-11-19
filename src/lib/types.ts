export type Account = "paper" | "live";
export type Mood = "first" | "second" | "third";

export interface Person {
  id: string;
  displayName: string;
  color: string;
  /** Displayable image URL per mood (signed URL or demo URL). Missing = emoji fallback. */
  gifs: Partial<Record<Mood, string>>;
}

export interface Snapshot {
  personId: string;
  account: Account;
  ts: string; // ISO timestamp
  equity: number;
  totalReturnPct: number;
}

export interface DailyRecord {
  personId: string;
  account: Account;
  date: string; // YYYY-MM-DD
  equity: number;
  dayReturnPct: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  strategy: string | null;
  trackingSince: string;
  receivedAt: string; // ISO timestamp
}

export interface Settings {
  competitionStart: string | null;
  competitionEnd: string | null;
  snapshotMinutes: number;
  staleAfterMinutes: number;
}

export interface Dataset {
  people: Person[];
  snapshots: Snapshot[];
  daily: DailyRecord[];
  settings: Settings;
}

export interface DataSource {
  readonly kind: "supabase" | "demo";
  load(): Promise<Dataset>;
  /** Calls `onChange` whenever new data may be available. Returns an unsubscribe fn. */
  subscribe(onChange: () => void): () => void;
}
