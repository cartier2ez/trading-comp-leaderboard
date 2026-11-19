# Bot Race

Shared leaderboard for the Jon / Ruben / Ian trading-bot competition. Highest % return
wins; SPY is a reference line. Live race during market hours, official score at the close,
rank-based faces (😁 1st, 😐 2nd, 😭 3rd) that swap when someone gets overtaken.

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
2. Install the CLI (`brew install supabase/tap/supabase`), then from this folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push                                  # creates tables, RLS, GIF bucket
supabase functions deploy report --no-verify-jwt  # the bot endpoint
```

3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
   Email (magic link) stays on.
4. **Authentication → URL Configuration**: Site URL = your Vercel URL; add
   `http://localhost:5173` to redirect URLs for local dev.
5. **Emails**: Supabase's built-in email sender is heavily rate-limited and may only
   deliver to your own org's team members. For Ruben and Ian to get magic links, set up
   custom SMTP (Authentication → Emails → SMTP; e.g. Resend's free tier).
6. **Authentication → Users → Invite user**: invite Ruben's and Ian's emails (and yours).
   A profile row is created automatically on invite.
7. Optional: edit the `settings` row (Table editor) once the rules are final.

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
npm test           # unit tests (validator, ranking, overtakes)
npm run typecheck
npm run build
```
