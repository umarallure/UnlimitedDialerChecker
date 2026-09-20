-- P4 · Predictive dialing settings.
-- `dial_settings` is what an operator wants; `campaigns_live` is what VICIdial actually holds,
-- synced by the agent. Nothing here changes the dialer: applying a plan is gated the same way
-- as rotation enforcement.

create table public.dial_settings (
  campaign_id          text primary key,
  dial_method          text not null default 'MANUAL'
                         check (dial_method in ('MANUAL', 'RATIO', 'ADAPT_HARD_LIMIT', 'ADAPT_TAPERED', 'ADAPT_AVERAGE')),
  lines_per_agent      numeric(3,1) not null default 1.0 check (lines_per_agent between 0 and 10),
  max_lines_per_agent  numeric(3,1) not null default 3.0 check (max_lines_per_agent between 1 and 10),
  -- The FTC Telemarketing Sales Rule caps abandoned calls at 3% a day per campaign.
  max_drop_pct         numeric(4,2) not null default 3.00 check (max_drop_pct between 0 and 3),
  dial_timeout_sec     integer not null default 30 check (dial_timeout_sec between 10 and 120),
  drop_call_seconds    integer not null default 2 check (drop_call_seconds between 1 and 20),
  hopper_level         integer not null default 20 check (hopper_level between 1 and 2000),
  available_only_tally boolean not null default true,
  -- Capacity the plan is checked against.
  planned_agents       integer not null default 5 check (planned_agents between 0 and 500),
  reserved_lines       integer not null default 3 check (reserved_lines >= 0),
  carrier_channels     integer not null default 300 check (carrier_channels > 0),
  updated_by           text,
  updated_at           timestamptz not null default now()
);

create table public.campaigns_live (
  campaign_id          text primary key,
  active               boolean,
  dial_method          text,
  lines_per_agent      numeric(3,1),
  max_lines_per_agent  numeric(3,1),
  max_drop_pct         numeric(4,2),
  dial_timeout_sec     integer,
  drop_call_seconds    integer,
  hopper_level         integer,
  available_only_tally boolean,
  agents_logged_in     integer,
  leads_in_hopper      integer,
  server_trunks        integer,
  synced_at            timestamptz not null default now()
);

create trigger dial_settings_touch before update on public.dial_settings
  for each row execute function public.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['dial_settings', 'campaigns_live'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_admin_all', t
    );
  end loop;
end $$;

alter publication supabase_realtime add table public.campaigns_live;

-- Seed the campaign we dial today with its current VICIdial values, so the first view of
-- the Dialing settings shows the truth rather than defaults.
insert into public.dial_settings (campaign_id, dial_method, lines_per_agent, max_lines_per_agent, max_drop_pct,
                                  dial_timeout_sec, drop_call_seconds, hopper_level, available_only_tally, updated_by)
values ('TESTCAMP', 'MANUAL', 1.0, 3.0, 3.00, 60, 5, 1, false, 'migration')
on conflict (campaign_id) do nothing;
