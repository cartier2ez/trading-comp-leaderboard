# Bot Race

Shared leaderboard for the Jon / Ruben / Ian Polymarket bot competition (simulation).
Highest % return wins. Live 24/7, with rank-based faces (😁 1st, 😐 2nd, 😭 3rd) that swap
when someone gets overtaken. The earlier stock season is archived, not deleted.

- Frontend: Vite + React + TypeScript, static, hosted on Vercel (or Netlify)
- Backend: Supabase (Postgres + row-level security, magic-link auth, Storage for GIFs,
  Realtime, one Edge Function `report` that bots POST to)
- Bots: see [BOT_GUIDE.md](BOT_GUIDE.md)

## Try it locally (no Supabase needed)

```bash
npm install
npm run dev:demo      # fake data for 3 bots, ticks every 3.5 s
```

## Setup (one time, Jon)

### 1. Supabase project

1. Create a free project at supabase.com.
2. The CLI is a dev dependency. From this folder:

```bash
npm install
npx supabase login
npx supabase link
npx supabase db push --remote --dry-run            # shows what would be applied
npx supabase db push --remote                      # tables, access rules, GIF bucket
npx supabase functions deploy report --no-verify-jwt
```

   When an AI assistant runs these, the CLI wants your OK for each production change.

3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
   Email (magic link) stays on.
4. **Authentication → URL Configuration**: Site URL = your Vercel URL; add
   `http://localhost:5173` to redirect URLs for local dev.
5. **Emails**: Supabase's built-in email sender is heavily rate-limited and may only
   deliver to your own org's team members. For Ruben and Ian to get magic links, set up
   custom SMTP (Authentication → Emails → SMTP; e.g. Resend's free tier).
6. **Authentication → Users → Invite user**: invite Ruben's and Ian's emails (and yours).
   A profile row is created automatically on invite.
7. Season dates and start equity live in the `seasons` table; `settings.current_season`
   picks the one shown. Returns are computed from these, so an edit takes effect at once.
   Real money stays closed until `live_start_equity` is set.

### 2. Vercel

1. Push this repo to GitHub (private is fine) and import it in Vercel. Framework: Vite.
2. Environment variables (from Supabase → Project Settings → API):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` (the anon / publishable key, **not** the service role key)
3. Deploy. Netlify works the same way (build `npm run build`, publish `dist`).

### 3. Local dev against Supabase

```bash
cp .env.example .env.local   # fill in URL + anon key
npm run dev
```

## Commands

```bash
npm run dev        # dev server (Supabase if .env.local is set, else demo)
npm run dev:demo   # always demo data
npm test           # unit tests + migrations and endpoint on an in-process Postgres
npm run typecheck
npm run build
```
