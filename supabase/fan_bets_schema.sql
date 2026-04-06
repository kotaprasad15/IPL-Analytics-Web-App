create extension if not exists pgcrypto;

do $$
begin
  create type public.match_status as enum ('upcoming', 'live', 'finished');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.bet_type as enum ('match_winner', 'next_wicket', 'over_under', 'player_runs');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.bet_status as enum ('open', 'locked', 'settled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.user_bet_status as enum ('pending', 'won', 'lost');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.fan_bet_slip_status as enum ('active', 'win', 'loss', 'push');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  email text unique,
  display_name text,
  email_hash text,
  encrypted_profile text not null default '',
  profile_iv text not null default '',
  profile_salt text not null default '',
  profile_kdf_iterations integer not null default 210000,
  points integer not null default 1000 check (points >= 0),
  total_placed integer not null default 0,
  total_bets integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  pushes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists username text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists email_hash text;
alter table public.users add column if not exists encrypted_profile text not null default '';
alter table public.users add column if not exists profile_iv text not null default '';
alter table public.users add column if not exists profile_salt text not null default '';
alter table public.users add column if not exists profile_kdf_iterations integer not null default 210000;
alter table public.users add column if not exists total_placed integer not null default 0;
alter table public.users add column if not exists total_bets integer not null default 0;
alter table public.users add column if not exists pushes integer not null default 0;

update public.users
set
  display_name = coalesce(nullif(display_name, ''), nullif(username, ''), split_part(coalesce(email, ''), '@', 1), 'Fan Player'),
  username = coalesce(nullif(username, ''), nullif(display_name, ''), split_part(coalesce(email, ''), '@', 1), 'Fan Player'),
  total_placed = coalesce(total_placed, total_bets, 0),
  total_bets = coalesce(total_bets, total_placed, 0),
  pushes = coalesce(pushes, 0),
  encrypted_profile = coalesce(encrypted_profile, ''),
  profile_iv = coalesce(profile_iv, ''),
  profile_salt = coalesce(profile_salt, ''),
  profile_kdf_iterations = coalesce(profile_kdf_iterations, 210000),
  points = coalesce(points, 1000),
  wins = coalesce(wins, 0),
  losses = coalesce(losses, 0)
where true;

alter table public.users alter column display_name set not null;
alter table public.users alter column username set not null;
alter table public.users alter column encrypted_profile set default '';
alter table public.users alter column profile_iv set default '';
alter table public.users alter column profile_salt set default '';
alter table public.users alter column profile_kdf_iterations set default 210000;
alter table public.users alter column points set default 1000;
alter table public.users alter column total_placed set default 0;
alter table public.users alter column total_bets set default 0;
alter table public.users alter column wins set default 0;
alter table public.users alter column losses set default 0;
alter table public.users alter column pushes set default 0;

create table if not exists public.matches (
  id text primary key,
  team_a text not null,
  team_b text not null,
  status public.match_status not null default 'upcoming',
  score jsonb not null default '{"teamA":"0/0","teamB":"0/0","overs":"0.0"}'::jsonb,
  start_time timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  type public.bet_type not null,
  question text not null,
  options jsonb not null,
  status public.bet_status not null default 'open',
  correct_option text default null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bet_id uuid not null references public.bets(id) on delete cascade,
  selected_option text not null,
  points_wagered integer not null check (points_wagered > 0),
  status public.user_bet_status not null default 'pending',
  points_won integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, bet_id)
);

create table if not exists public.fan_bet_slips (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  market_id text not null,
  match_id text not null,
  match_name text not null,
  market_type text not null,
  market_title text not null,
  market_badge text,
  option_id text not null,
  option_label text not null,
  stake integer not null check (stake > 0),
  payout_multiplier numeric(10, 4) not null default 1,
  payout integer not null default 0,
  net_points integer not null default 0,
  status public.fan_bet_slip_status not null default 'active',
  placed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fan_bet_slips_user_idx on public.fan_bet_slips(user_id, placed_at desc);
create index if not exists fan_bet_slips_user_status_idx on public.fan_bet_slips(user_id, status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_matches_updated_at on public.matches;
create trigger set_matches_updated_at
before update on public.matches
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_bets_updated_at on public.bets;
create trigger set_bets_updated_at
before update on public.bets
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_user_bets_updated_at on public.user_bets;
create trigger set_user_bets_updated_at
before update on public.user_bets
for each row
execute procedure public.set_updated_at();

drop trigger if exists set_fan_bet_slips_updated_at on public.fan_bet_slips;
create trigger set_fan_bet_slips_updated_at
before update on public.fan_bet_slips
for each row
execute procedure public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.users (
    id,
    username,
    email,
    display_name,
    email_hash,
    encrypted_profile,
    profile_iv,
    profile_salt,
    profile_kdf_iterations,
    points,
    total_placed,
    total_bets,
    wins,
    losses,
    pushes
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), 'Fan Player'),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), 'Fan Player'),
    encode(digest(lower(coalesce(new.email, '')), 'sha256'), 'hex'),
    coalesce(new.raw_user_meta_data ->> 'encrypted_profile', ''),
    coalesce(new.raw_user_meta_data ->> 'profile_iv', ''),
    coalesce(new.raw_user_meta_data ->> 'profile_salt', ''),
    coalesce((new.raw_user_meta_data ->> 'profile_kdf_iterations')::integer, 210000),
    1000,
    0,
    0,
    0,
    0,
    0
  )
  on conflict (id) do update
  set
    username = excluded.username,
    email = excluded.email,
    display_name = excluded.display_name,
    email_hash = excluded.email_hash,
    encrypted_profile = case
      when public.users.encrypted_profile = '' then excluded.encrypted_profile
      else public.users.encrypted_profile
    end,
    profile_iv = case
      when public.users.profile_iv = '' then excluded.profile_iv
      else public.users.profile_iv
    end,
    profile_salt = case
      when public.users.profile_salt = '' then excluded.profile_salt
      else public.users.profile_salt
    end,
    profile_kdf_iterations = coalesce(public.users.profile_kdf_iterations, excluded.profile_kdf_iterations);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_auth_user();

create or replace view public.leaderboard as
select
  id as user_id,
  display_name as username,
  points
from public.users
order by points desc;

alter table public.users enable row level security;
alter table public.matches enable row level security;
alter table public.bets enable row level security;
alter table public.user_bets enable row level security;
alter table public.fan_bet_slips enable row level security;

drop policy if exists "Public read access to users" on public.users;
create policy "Public read access to users"
on public.users
for select
using (true);

drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile"
on public.users
for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Public read access to matches" on public.matches;
create policy "Public read access to matches"
on public.matches
for select
using (true);

drop policy if exists "Public read access to bets" on public.bets;
create policy "Public read access to bets"
on public.bets
for select
using (true);

drop policy if exists "Users can read own bets" on public.user_bets;
create policy "Users can read own bets"
on public.user_bets
for select
using (auth.uid() = user_id);

drop policy if exists "Users can place own bets" on public.user_bets;
create policy "Users can place own bets"
on public.user_bets
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own bets" on public.user_bets;
create policy "Users can update own bets"
on public.user_bets
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own fan bet slips" on public.fan_bet_slips;
create policy "Users can read own fan bet slips"
on public.fan_bet_slips
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own fan bet slips" on public.fan_bet_slips;
create policy "Users can insert own fan bet slips"
on public.fan_bet_slips
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own fan bet slips" on public.fan_bet_slips;
create policy "Users can update own fan bet slips"
on public.fan_bet_slips
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
