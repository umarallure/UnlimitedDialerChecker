-- P0 · Foundations: admin allowlist, DID pool, lifecycle audit, stats, reputation,
-- live agents, commands, alerts, recent calls. Every table is admin-only under RLS,
-- and admin access requires an MFA-verified (aal2) session.

create extension if not exists pgcrypto;

-- ─── Admins ──────────────────────────────────────────────────────────────────
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
     and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

-- Lets the app tell a signed-in user "not on the allowlist" apart from "needs MFA"
-- without exposing the admins table at aal1.
create or replace function public.is_listed_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_listed_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_listed_admin() to authenticated;

-- ─── Enums ───────────────────────────────────────────────────────────────────
create type public.did_lifecycle as enum ('NEW', 'WARMING', 'ACTIVE', 'COOLING', 'RETIRED');
create type public.reputation_label as enum ('clean', 'spam_likely', 'scam_likely', 'blocked', 'unknown');
create type public.command_status as enum ('queued', 'running', 'done', 'failed');
create type public.alert_severity as enum ('info', 'warning', 'critical');
create type public.enforcement_mode as enum ('dry_run', 'enforce');

-- ─── Dialers ─────────────────────────────────────────────────────────────────
create table public.dialers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  agent_version     text,
  last_heartbeat_at timestamptz,
  status            text not null default 'unknown',
  created_at        timestamptz not null default now()
);

-- ─── Policy (single active row) ──────────────────────────────────────────────
create table public.policies (
  id               uuid primary key default gen_random_uuid(),
  is_active        boolean not null default true,
  enforcement_mode public.enforcement_mode not null default 'dry_run',
  settings         jsonb not null,
  updated_by       text,
  updated_at       timestamptz not null default now()
);
create unique index policies_one_active on public.policies (is_active) where is_active;

insert into public.policies (settings, updated_by) values (
  jsonb_build_object(
    'agingDays', 7,
    'warmupDailyCaps', jsonb_build_array(20, 40, 60),
    'activeDailyCap', 60,
    'hourlyCap', 12,
    'maxActiveDaysPer7', 5,
    'restDaysEvery30', 2,
    'promote', jsonb_build_object('minAnswerRate', 0.10, 'maxShortCallPct', 0.20, 'maxDropPct', 0.03),
    'hardCool', jsonb_build_object('minAnswerRate3d', 0.08, 'maxShortCallPct', 0.30, 'maxDropPct', 0.03, 'sip608Spike', 5),
    'softCool', jsonb_build_object('answerRateDropPts', 0.05, 'shortCallPctFrom', 0.20),
    'coolingDays', 14,
    'reentryDailyCap', 25,
    'retireIfLabeledAtDay', 30,
    'retireIfRetriggeredWithinDays', 60,
    'shortCallSeconds', 6
  ),
  'migration'
);

-- ─── DIDs ────────────────────────────────────────────────────────────────────
create table public.dids (
  id                uuid primary key default gen_random_uuid(),
  e164              text not null unique check (e164 ~ '^\+1[2-9][0-9]{9}$'),
  area_code         text generated always as (substring(e164 from 3 for 3)) stored,
  state             text check (state ~ '^[A-Z]{2}$'),
  carrier           text not null default 'teleinx',
  attestation       text check (attestation in ('A', 'B', 'C')),
  lifecycle         public.did_lifecycle not null default 'NEW',
  lifecycle_since   timestamptz not null default now(),
  warmup_week       smallint not null default 0,
  daily_cap         integer not null default 0,
  hourly_cap        integer not null default 0,
  manual_hold       boolean not null default false,
  manual_hold_reason text,
  fcr_registered_at timestamptz,
  cnam              text,
  inbound_route_ok  boolean not null default false,
  purchased_at      date,
  mrc_cents         integer,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index dids_state_idx on public.dids (state);
create index dids_lifecycle_idx on public.dids (lifecycle);

create table public.did_state_events (
  id         bigint generated always as identity primary key,
  did_id     uuid not null references public.dids (id) on delete cascade,
  from_state public.did_lifecycle,
  to_state   public.did_lifecycle not null,
  reason     text not null,
  actor      text not null,
  dry_run    boolean not null default false,
  metrics    jsonb,
  created_at timestamptz not null default now()
);
create index did_state_events_did_idx on public.did_state_events (did_id, created_at desc);

-- ─── Stats ───────────────────────────────────────────────────────────────────
create table public.did_stats_live (
  did_id            uuid primary key references public.dids (id) on delete cascade,
  calls_today       integer not null default 0,
  calls_last_hour   integer not null default 0,
  answered_today    integer not null default 0,
  short_calls_today integer not null default 0,
  drops_today       integer not null default 0,
  sip_rejects_today integer not null default 0,
  last_call_at      timestamptz,
  updated_at        timestamptz not null default now()
);

create table public.did_stats_daily (
  did_id            uuid not null references public.dids (id) on delete cascade,
  day               date not null,
  calls             integer not null default 0,
  answered          integer not null default 0,
  human_answer_rate numeric(5,4),
  short_call_pct    numeric(5,4),
  avg_talk_sec      numeric(8,2),
  drops             integer not null default 0,
  sip_503           integer not null default 0,
  sip_603           integer not null default 0,
  sip_608           integer not null default 0,
  unique_numbers    integer not null default 0,
  primary key (did_id, day)
);

create table public.calls_recent (
  uniqueid     text primary key,
  call_date    timestamptz not null,
  did_id       uuid references public.dids (id) on delete set null,
  outbound_cid text,
  lead_phone_last4 text,
  campaign_id  text,
  agent_user   text,
  status       text,
  length_sec   integer,
  sip_code     text,
  sip_reason   text,
  call_type    text
);
create index calls_recent_date_idx on public.calls_recent (call_date desc);
create index calls_recent_did_idx on public.calls_recent (did_id, call_date desc);

-- ─── Reputation ──────────────────────────────────────────────────────────────
create table public.reputation_scans (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null default 'mycallscore',
  scope           text not null check (scope in ('full', 'spam_only', 'carrier_only')),
  did_ids         uuid[] not null,
  status          public.command_status not null default 'queued',
  cost_cents      integer,
  requested_by    text not null,
  provider_job_id text,
  error           text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create table public.reputation_checks (
  id         bigint generated always as identity primary key,
  did_id     uuid not null references public.dids (id) on delete cascade,
  scan_id    uuid references public.reputation_scans (id) on delete set null,
  source     text not null,
  label      public.reputation_label not null,
  score      numeric,
  raw        jsonb,
  checked_at timestamptz not null default now()
);
create index reputation_checks_did_idx on public.reputation_checks (did_id, checked_at desc);

-- ─── Live agents snapshot ────────────────────────────────────────────────────
create table public.agents_live (
  agent_user        text primary key,
  full_name         text,
  status            text not null,
  pause_code        text,
  campaign_id       text,
  lead_id           bigint,
  calls_today       integer,
  state_since       timestamptz,
  updated_at        timestamptz not null default now()
);

-- ─── Commands & alerts ───────────────────────────────────────────────────────
create table public.commands (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('hold_did', 'release_did', 'force_cool', 'retire_did', 'set_cap', 'resync')),
  payload     jsonb not null default '{}'::jsonb,
  status      public.command_status not null default 'queued',
  result      jsonb,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index commands_queue_idx on public.commands (status, created_at) where status in ('queued', 'running');

create table public.alerts (
  id          bigint generated always as identity primary key,
  kind        text not null,
  severity    public.alert_severity not null default 'warning',
  did_id      uuid references public.dids (id) on delete cascade,
  message     text not null,
  emailed_at  timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index alerts_open_idx on public.alerts (created_at desc) where resolved_at is null;

-- ─── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger dids_touch before update on public.dids
  for each row execute function public.touch_updated_at();
create trigger policies_touch before update on public.policies
  for each row execute function public.touch_updated_at();

-- ─── RLS: admin-only everywhere ──────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'admins', 'dialers', 'policies', 'dids', 'did_state_events', 'did_stats_live',
    'did_stats_daily', 'calls_recent', 'reputation_scans', 'reputation_checks',
    'agents_live', 'commands', 'alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- The service-role key (dialer agent, server jobs) bypasses RLS by design.

-- ─── Realtime for the live screens ───────────────────────────────────────────
alter publication supabase_realtime add table public.agents_live, public.did_stats_live, public.alerts, public.commands;
