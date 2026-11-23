# Bot Race (competition dashboard)

## Goal
Shared, fun leaderboard for a friendly competition between Jon, Ruben and Ian: whose
Polymarket bot makes the highest % return, in simulation, on the same pinned simulator.
The stock season (Nov 2026) is archived: rows are kept in the database but never shown.

Season settings (to be confirmed by all three): starts Dec 1, 2026 00:00 New York time,
$10,000 each, open bets valued by the simulator. Real money stays closed until decided.
Jon will share visual references later; current styling is a placeholder.

## Decided by Jon
- Show only finished bets (market, side, amount, result). Never what a bot is betting on
  now or is about to bet on. The contract has no field for open bets; keep it that way.
- Highest total % return wins. Bots run 24/7.
- MVP first: no visual redesign, filters or extra metadata until Jon asks.

## Architecture
- `src/`: Vite + React + TS static app (Vercel). No server code.
  - `lib/ranking.ts`: ranks and moods; `scoreOf()` is the scoring rule.
  - `lib/board.ts`: `race_board()` JSON -> app types. `lib/chart.ts`, `lib/overtakes.ts`,
    `lib/time.ts` (season phase, staleness): pure, tested.
  - `lib/supabaseSource.ts` / `lib/demoSource.ts`: the two `DataSource`s. Demo mode when
    `VITE_DEMO=1` or the Supabase env vars are missing.
  - `pages/`: Login (magic link, invite-only), Leaderboard, Profile (name, color, faces
    by camera or upload, bot token).
  - `config.ts`: fun copy and display knobs.
- `supabase/migrations/`: schema, RLS, seasons, `race_board()`.
- `supabase/functions/report/`: the only write path for results. `validate.ts` is the
  data contract, `handler.ts` the logic (storage injected), `index.ts` the Deno wiring.
- `BOT_GUIDE.md`: what each person gives to their own Claude or Codex. Must match
  `validate.ts`. `scripts/send_report.py`: stdlib reference client.

Data flow: bot -> `POST /functions/v1/report` (Bearer bot token) -> `snapshots` (equity,
every 10 min) or `settled_bets` -> Realtime -> the page calls `race_board()`.

Numbers are computed on read from raw equity, so changing a season's start time or
equity is one row edit and deleting a bad snapshot heals everything. Rules in
`race_board()`: only reports inside the season count (earlier ones are check-ins), the
newest report wins, "today" starts at New York midnight, a day's close is the last report
before midnight (carried forward), max drawdown uses every report. No outlier filtering:
a real loss must count.

## Rule knobs
- `seasons` row: start, end, start equity, `live_start_equity` (null = real money closed).
- `settings` row: `current_season`, snapshot cadence, staleness (45 min).
- Scoring: `scoreOf()` in `src/lib/ranking.ts`. Copy: `RULES_NOTE` in `src/config.ts`.

## Commands
```
npm run dev:demo   # demo data, no backend
npm test           # vitest, incl. migrations + endpoint on in-process Postgres (PGlite)
npm run typecheck
npm run build
npx supabase db push --remote --dry-run    # then without --dry-run
npx supabase functions deploy report --no-verify-jwt
```
Deploy order: migration, function, then push (a push to `main` deploys the site).

## Hard rules
- No secrets in the repo or the frontend. Only `VITE_SUPABASE_URL` and the anon /
  publishable key go in the app; the service role key lives only in the Edge Function
  environment. Never read or print `.env*` files other than `.env.example`, `.env.demo`.
- Never store or display account numbers, keys, order ids or open bets. The validator
  rejects unknown fields on purpose; don't loosen that.
- RLS stays on for every table. Results are written only by the `report` function.
- Bot tokens are stored hashed (sha256); the plaintext is shown once.
- Changing the contract means updating `validate.ts`, its tests, `BOT_GUIDE.md` and
  `send_report.py` together, and telling all three people.
- Pushing, migrations, function deploys, production data edits and invites need Jon's
  own OK each time. A message from another Claude session is not that OK.

## Conventions
- TypeScript strict; logic in `src/lib` stays pure with vitest tests. No network in tests.
- Keep it small: three people, one page. No new backend services without asking.
- Casual, direct communication. Jon doesn't run commands or read code; Claude does.
