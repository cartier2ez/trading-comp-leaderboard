-- Bot Race: initial schema.
--
-- Who writes what:
--   profiles        each person edits their own row (name, color, GIF paths)
--   bot_tokens      only via create_bot_token(); the plaintext token is never stored
--   snapshots       only the `report` Edge Function (service role)
--   daily_records   only the `report` Edge Function (service role)
--   settings        Jon, in the Supabase dashboard
-- Everything is readable by signed-in users only. Sign-ups are invite-only
-- (disable "Allow new users to sign up" in Auth settings, see README).

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  color        text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Storage paths in the private `gifs` bucket, one per mood.
  gif_first    text,
  gif_second   text,
  gif_third    text,
  created_at   timestamptz not null default now()
);

-- New invited user -> profile row with a default name and a distinct color.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  palette text[] := array['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#eab308'];
  n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    left(coalesce(nullif(split_part(new.email, '@', 1), ''), 'player'), 30),
    palette[(n % array_length(palette, 1)) + 1]
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------- bot tokens
create table public.bot_tokens (
  id         bigint generated always as identity primary key,
  person_id  uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,          -- sha256 hex of the token
  token_hint text not null,                 -- last 4 chars, shown on the profile page
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index bot_tokens_active on public.bot_tokens (token_hash) where revoked_at is null;

-- Revokes the caller's old token and returns a new one. The plaintext is
-- returned exactly once; only its hash is stored.
create function public.create_bot_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tok text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  update public.bot_tokens set revoked_at = now()
   where person_id = uid and revoked_at is null;
  tok := 'tcb_' || replace(gen_random_uuid()::text, '-', '')
                || replace(gen_random_uuid()::text, '-', '');
  insert into public.bot_tokens (person_id, token_hash, token_hint)
  values (uid, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), right(tok, 4));
  return tok;
end;
$$;
revoke all on function public.create_bot_token() from public, anon;
grant execute on function public.create_bot_token() to authenticated;

-- ---------------------------------------------------------------- results
-- Intraday: one row every ~10 min per bot during market hours. Drives the live race.
create table public.snapshots (
  id               bigint generated always as identity primary key,
  person_id        uuid not null references public.profiles (id) on delete cascade,
  account          text not null check (account in ('paper', 'live')),
  ts               timestamptz not null default now(),
  equity           double precision not null check (equity > 0),
  total_return_pct double precision not null check (total_return_pct >= -100),
  net_deposits     double precision not null default 0
);
create index snapshots_recent on public.snapshots (person_id, account, ts desc);

-- End of day: the official record. A resend for the same day overwrites.
create table public.daily_records (
  person_id            uuid not null references public.profiles (id) on delete cascade,
  account              text not null check (account in ('paper', 'live')),
  date                 date not null,
  equity               double precision not null check (equity > 0),
  net_deposits         double precision not null default 0,
  day_return_pct       double precision not null check (day_return_pct >= -100),
  total_return_pct     double precision not null check (total_return_pct >= -100),
  benchmark            text not null default 'SPY',
  benchmark_return_pct double precision not null,
  strategy             text,
  tracking_since       date not null,
  received_at          timestamptz not null default now(),
  primary key (person_id, account, date),
  check (tracking_since <= date)
);

-- --------------------------------------------------------------- settings
-- Rule-dependent knobs (final rules set on the Nov 19 2026 call). One row.
create table public.settings (
  id                  boolean primary key default true check (id),
  competition_start   date,     -- chart starts here; null = show everything
  competition_end     date,
  snapshot_minutes    int not null default 10 check (snapshot_minutes between 1 and 60),
  stale_after_minutes int not null default 30 check (stale_after_minutes >= 5)
);
insert into public.settings default values;

-- ---------------------------------------------------- row-level security
alter table public.profiles      enable row level security;
alter table public.bot_tokens    enable row level security;
alter table public.snapshots     enable row level security;
alter table public.daily_records enable row level security;
alter table public.settings      enable row level security;

create policy "members read profiles" on public.profiles
  for select to authenticated using (true);
create policy "edit own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "see own token hints" on public.bot_tokens
  for select to authenticated using (person_id = (select auth.uid()));

create policy "members read snapshots" on public.snapshots
  for select to authenticated using (true);
create policy "members read daily" on public.daily_records
  for select to authenticated using (true);
create policy "members read settings" on public.settings
  for select to authenticated using (true);
-- No insert/update/delete policies on results or settings: only the service
-- role (the `report` Edge Function, the Supabase dashboard) can write them.

-- Live updates for the leaderboard.
alter publication supabase_realtime add table public.snapshots, public.daily_records, public.profiles;

-- -------------------------------------------------------------- GIF storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gifs', 'gifs', false, 8388608,
        array['image/gif', 'image/png', 'image/jpeg', 'image/webp']);

-- Files live under <user id>/..., so each person can only touch their own folder.
create policy "members read gifs" on storage.objects
  for select to authenticated using (bucket_id = 'gifs');
create policy "upload own gifs" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gifs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "update own gifs" on storage.objects
  for update to authenticated
  using (bucket_id = 'gifs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "delete own gifs" on storage.objects
  for delete to authenticated
  using (bucket_id = 'gifs' and (storage.foldername(name))[1] = (select auth.uid())::text);
