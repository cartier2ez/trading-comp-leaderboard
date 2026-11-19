# Bot Race (competition dashboard)

## Goal
Shared, fun leaderboard for a friendly trading-bot competition between Jon, Ruben and
Ian. Highest % return wins. SPY buy-and-hold is a reference line only, never ranked.
Paper trading first; each person may switch to real money ($500) any time, tracked in a
separate "Real money" tab. Final rules are set on the Thu Nov 19, 2026 call, so keep
rule-dependent logic in the few places listed under "Rule knobs".

Jon will share visual references for the look; current styling is a placeholder.

## Architecture
- `src/`: Vite + React + TS static app (Vercel/Netlify). No server code.
  - `lib/ranking.ts`: standings, ranks, moods, max drawdown. Pure, tested.
  - `lib/chart.ts`: race chart and sparkline rows. `lib/overtakes.ts`: overtake detection.
  - `lib/supabaseSource.ts` / `lib/demoSource.ts`: the two `DataSource`s. Demo mode
    when `VITE_DEMO=1` or Supabase env vars are missing.
  - `pages/`: Login (magic link, invite-only), Leaderboard (Paper / Real money tabs),
    Profile (name, color, 3 rank GIFs, bot token).
  - `config.ts`: fun copy (taglines, overtake lines, emoji fallbacks).
- `supabase/migrations/`: schema, RLS, GIF bucket, `create_bot_token()` RPC.
- `supabase/functions/report/`: the only write path for results. `validate.ts` is the
  data contract (pure TS, shared with tests); `index.ts` does token auth + insert/upsert.
- `BOT_GUIDE.md`: what each person hands to their own Claude. Must match `validate.ts`.
- `scripts/send_report.py`: stdlib reference client used by the guide.

Data flow: bot → `POST /functions/v1/report` (Bearer bot token) → `snapshots` (every
~10 min, live race) or `daily_records` (after close, official) → Realtime → page reloads.
Ranking uses the latest snapshot if it's from a later trading day than the latest daily
record; otherwise the daily record.

## Rule knobs (change these after the Nov 19 call)
- Scoring: `scoreOf()` in `src/lib/ranking.ts` (currently total % return).
- Dates / snapshot cadence / staleness: `settings` table.
- Copy shown under the board: `RULES_NOTE` in `src/config.ts`.
- Open question: if people start on different days their SPY lines differ; the race
  chart uses the earliest starter's SPY (`raceRows` in `src/lib/chart.ts`).

## Commands
```
npm run dev:demo   # demo data, no backend
npm run dev        # against Supabase (.env.local)
npm test           # vitest
npm run typecheck  # tsc --noEmit, strict
npm run build
supabase db push / supabase functions deploy report --no-verify-jwt   # Jon runs these
```

## Hard rules
- No secrets in the repo or the frontend. Only `VITE_SUPABASE_URL` and the anon /
  publishable key go in the app; the service role key lives only in Supabase's Edge
  Function environment. Never read or print `.env*` files other than `.env.example`
  and `.env.demo`.
- Never store or display account numbers, API keys, order IDs or other account
  identifiers. The validator rejects unknown fields on purpose; don't loosen that.
- RLS stays on for every table. Results are written only by the `report` function.
- Bot tokens are stored hashed (sha256); the plaintext is shown once.
- Changing the report schema means updating `validate.ts`, its tests, `BOT_GUIDE.md`
  and `send_report.py` together, and telling all three people (their bots depend on it).
- Deploys, Supabase changes and inviting users are Jon's actions; don't run them
  without being asked.

## Conventions
- TypeScript strict; logic in `src/lib` stays pure and gets vitest tests. Tests never
  hit the network.
- Keep it small: three people, one page. No new backend services without asking.
- Casual, direct communication; Jon is a senior engineer.
