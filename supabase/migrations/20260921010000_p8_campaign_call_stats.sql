-- P8 · Call reporting facts, and the names behind the status codes.
--
-- One row per campaign, day, hour, agent and outcome. Hour-level rows are what let a manager ask
-- "last month, mornings only" without keeping every call for ever — the call feed is a seven-day
-- window on purpose. Duration counts are stored rather than derived: how many talks ran past two
-- minutes cannot be recovered from a sum of seconds.
create table public.campaign_call_stats (
  campaign_id    text not null,
  day            date not null,
  hour           smallint not null check (hour between 0 and 23),
  agent_user     text not null default '',   -- '' when no agent took the call (VDAD/VDCL)
  status         text not null,
  calls          integer not null default 0,
  talk_sec       integer not null default 0,
  calls_60_plus  integer not null default 0,
  calls_120_plus integer not null default 0,
  calls_300_plus integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (campaign_id, day, hour, agent_user, status)
);
create index campaign_call_stats_day_idx on public.campaign_call_stats (day desc, campaign_id);

alter table public.campaign_call_stats enable row level security;
revoke all on public.campaign_call_stats from anon;
create policy campaign_call_stats_admin_all on public.campaign_call_stats for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Without these a manager reads "DNQ" and has to guess. System statuses are shared by every
-- campaign and arrive under campaign_id '-', which is what VICIdial itself uses for them.
create table public.dialer_campaign_statuses (
  campaign_id        text not null,
  status             text not null,
  status_name        text,
  selectable         boolean not null default false,
  human_answered     boolean not null default false,
  sale               boolean not null default false,
  dnc                boolean not null default false,
  not_interested     boolean not null default false,
  unworkable         boolean not null default false,
  scheduled_callback boolean not null default false,
  synced_at          timestamptz not null default now(),
  primary key (campaign_id, status)
);

alter table public.dialer_campaign_statuses enable row level security;
revoke all on public.dialer_campaign_statuses from anon;
create policy dialer_campaign_statuses_admin_read on public.dialer_campaign_statuses for select to authenticated
  using ((select private.is_admin()));
