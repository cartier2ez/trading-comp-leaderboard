-- Bot Race v2: Polymarket season.
--
-- Additive: no rows are deleted, and the v1 function and site keep working
-- until they are replaced (new columns default to the stocks season).
--
--   seasons        one row per competition; results never mix across seasons
--   settled_bets   finished bets only; open bets are never sent or stored
--   race_board()   everything the page shows, computed from raw equity
--
-- Returns are computed on read, so changing a season's start time or start
-- equity is one edit and never leaves stale numbers behind.

-- ---------------------------------------------------------------- seasons
create table public.seasons (
  id                text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name              text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz check (ends_at > starts_at),
  start_equity      double precision not null check (start_equity > 0),
  -- Real money: null = not open yet, "live" reports are rejected.
  live_start_equity double precision check (live_start_equity > 0)
);

insert into public.seasons (id, name, starts_at, start_equity) values
  ('stocks-2026', 'Stocks (archived)', timestamp '2026-11-18 00:00' at time zone 'America/New_York', 100000),
  ('polymarket-2026', 'Polymarket', timestamp '2026-12-01 00:00' at time zone 'America/New_York', 10000);

alter table public.settings
  add column current_season text not null default 'polymarket-2026' references public.seasons (id);
alter table public.settings alter column stale_after_minutes set default 45;
update public.settings set stale_after_minutes = 45;

-- -------------------------------------------------------------- snapshots
-- The default tags existing rows (and any late v1 report) as stocks.
alter table public.snapshots
  add column season         text not null default 'stocks-2026' references public.seasons (id),
  add column open_positions int check (open_positions >= 0),
  add column settled_bets   int check (settled_bets >= 0),
  add column won_bets       int check (won_bets >= 0),
  add column fees_paid      double precision check (fees_paid >= 0),
  add column sim_version    text;
-- v2 stores equity only; a bot that loses everything has equity 0.
alter table public.snapshots alter column total_return_pct drop not null;
alter table public.snapshots drop constraint snapshots_equity_check;
alter table public.snapshots add constraint snapshots_equity_check check (equity >= 0);
create index snapshots_season on public.snapshots (season, person_id, account, ts desc, id desc);

-- ---------------------------------------------------------- daily records
-- v1 only: v2 derives each day's close from snapshots. Kept as the archive.
alter table public.daily_records
  add column season text not null default 'stocks-2026' references public.seasons (id);
alter table public.daily_records drop constraint daily_records_pkey;
alter table public.daily_records add primary key (person_id, season, account, date);

-- ----------------------------------------------------------- settled bets
create table public.settled_bets (
  person_id    uuid not null references public.profiles (id) on delete cascade,
  season       text not null references public.seasons (id),
  account      text not null check (account in ('paper', 'live')),
  market_slug  text not null,
  side         text not null,
  settled_at   timestamptz not null,
  market_title text not null,
  stake        double precision not null check (stake > 0),
  pnl          double precision not null,
  result       text not null check (result in ('won', 'lost', 'push')),
  received_at  timestamptz not null default now(),
  -- A resend of the same bet overwrites it instead of duplicating it.
  primary key (person_id, season, account, market_slug, side, settled_at)
);
create index settled_bets_recent on public.settled_bets (season, settled_at desc);

-- ---------------------------------------------------- row-level security
alter table public.seasons      enable row level security;
alter table public.settled_bets enable row level security;
create policy "members read seasons" on public.seasons
  for select to authenticated using (true);
create policy "members read settled bets" on public.settled_bets
  for select to authenticated using (true);

-- Explicit grants, so this doesn't depend on the project's default privileges.
revoke all on public.seasons, public.settled_bets from anon, authenticated;
grant select on public.seasons, public.settled_bets to authenticated;
grant select on public.seasons, public.settings to service_role;
grant select, insert, update on public.settled_bets to service_role;

alter publication supabase_realtime add table public.settled_bets;

-- ------------------------------------------------------------- race board
-- Runs as the caller, so row-level security applies. `p_now` exists for tests.
--   * Only reports inside the season count; earlier ones are "check-ins".
--   * The newest report wins.
--   * A day's close is the last report before New York midnight, carried
--     forward over days when the bot was offline.
--   * Max drawdown uses every report, starting from the start equity.
create function public.race_board(p_now timestamptz default now())
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with s as (
  select se.*
  from public.settings st
  join public.seasons se on se.id = st.current_season
),
ref as (
  select s.*,
    (s.starts_at at time zone 'America/New_York')::date as first_day,
    (least(p_now, s.ends_at - interval '1 microsecond') at time zone 'America/New_York')::date as today
  from s
),
counted as (
  select sn.id, sn.person_id, sn.account, sn.ts, sn.equity, sn.open_positions,
    sn.settled_bets, sn.won_bets, sn.fees_paid, sn.sim_version,
    (sn.ts at time zone 'America/New_York')::date as d,
    case sn.account when 'live' then r.live_start_equity else r.start_equity end as start_eq
  from public.snapshots sn
  join ref r on sn.season = r.id
  where sn.ts >= r.starts_at
    and sn.ts <= p_now
    and (r.ends_at is null or sn.ts < r.ends_at)
    and (sn.account = 'paper' or r.live_start_equity is not null)
),
latest as (
  select distinct on (person_id, account) *
  from counted
  order by person_id, account, ts desc, id desc
),
peaks as (
  select person_id, account, equity,
    greatest(start_eq, max(equity) over (partition by person_id, account order by ts, id)) as peak
  from counted
),
dd as (
  select person_id, account, least(0, min(equity / peak - 1)) * 100 as max_dd
  from peaks
  group by person_id, account
),
day_last as (
  select distinct on (person_id, account, d) person_id, account, d, equity
  from counted
  order by person_id, account, d, ts desc, id desc
),
stats as (
  select l.*, dd.max_dd, coalesce(prev.equity, l.start_eq) as prev_equity
  from latest l
  join dd using (person_id, account)
  cross join ref r
  left join lateral (
    select x.equity from day_last x
    where x.person_id = l.person_id and x.account = l.account and x.d < r.today
    order by x.d desc limit 1
  ) prev on true
),
closes as (
  select l.person_id, l.account, g.day::date as d, (x.equity / l.start_eq - 1) * 100 as total
  from latest l
  cross join ref r
  cross join lateral generate_series(r.first_day::timestamp, (r.today - 1)::timestamp, interval '1 day') as g (day)
  cross join lateral (
    select y.equity from day_last y
    where y.person_id = l.person_id and y.account = l.account and y.d <= g.day::date
    order by y.d desc limit 1
  ) x
),
check_ins as (
  select distinct on (sn.person_id) sn.person_id, sn.ts
  from public.snapshots sn
  join ref r on sn.season = r.id
  where sn.ts < r.starts_at and sn.ts <= p_now
  order by sn.person_id, sn.ts desc
),
bets as (
  select b.*
  from public.settled_bets b
  join ref r on b.season = r.id
  where b.settled_at >= r.starts_at
    and (r.ends_at is null or b.settled_at < r.ends_at)
    and (b.account = 'paper' or r.live_start_equity is not null)
  order by b.settled_at desc, b.received_at desc
  limit 30
)
select jsonb_build_object(
  'season', (select jsonb_build_object(
      'id', id, 'name', name, 'starts_at', starts_at, 'ends_at', ends_at, 'start_equity', start_equity) from s),
  'stats', coalesce((select jsonb_agg(jsonb_build_object(
      'person_id', person_id, 'account', account, 'last_seen', ts, 'equity', equity,
      'total_return_pct', (equity / start_eq - 1) * 100,
      'today_pct', case when prev_equity > 0 then (equity / prev_equity - 1) * 100 else 0 end,
      'max_drawdown_pct', max_dd, 'open_positions', open_positions, 'settled_bets', settled_bets,
      'won_bets', won_bets, 'fees_paid', fees_paid, 'sim_version', sim_version)) from stats), '[]'::jsonb),
  'closes', coalesce((select jsonb_agg(jsonb_build_object(
      'person_id', person_id, 'account', account, 'date', d, 'total_return_pct', total)
      order by d, person_id) from closes), '[]'::jsonb),
  'check_ins', coalesce((select jsonb_agg(jsonb_build_object('person_id', person_id, 'at', ts)) from check_ins), '[]'::jsonb),
  'bets', coalesce((select jsonb_agg(jsonb_build_object(
      'person_id', person_id, 'account', account, 'market_slug', market_slug, 'market_title', market_title,
      'side', side, 'stake', stake, 'pnl', pnl, 'result', result, 'settled_at', settled_at)
      order by settled_at desc, received_at desc) from bets), '[]'::jsonb)
);
$$;
revoke all on function public.race_board(timestamptz) from public, anon;
grant execute on function public.race_board(timestamptz) to authenticated;
