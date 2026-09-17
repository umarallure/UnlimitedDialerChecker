-- P2 · Health checks and email alerts.
-- private.evaluate_health() runs every 15 minutes (pg_cron), opens/refreshes/auto-resolves alerts
-- from per-number stats, then the `alerts-notify` Edge Function emails critical alerts and a daily digest.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ─── Alerts: one open alert per problem ──────────────────────────────────────
alter table public.alerts
  add column dedupe_key   text,
  add column details      jsonb,
  add column last_seen_at timestamptz not null default now(),
  add column resolved_by  text;

create unique index alerts_open_dedupe_idx on public.alerts (dedupe_key) where resolved_at is null;
create index alerts_did_open_idx on public.alerts (did_id) where resolved_at is null;

-- ─── Notification settings (single row) and send log ─────────────────────────
create table public.notification_settings (
  id                boolean primary key default true check (id),
  recipients        text[]  not null,
  immediate_enabled boolean not null default true,
  digest_enabled    boolean not null default true,
  digest_hour_et    smallint not null default 8 check (digest_hour_et between 0 and 23),
  last_run_at       timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);
-- Recipients default to the admin allowlist; change them in the table afterwards if needed.
insert into public.notification_settings (recipients)
select coalesce(array_agg(email order by created_at), '{}') from public.admins;

create table public.notification_log (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('immediate', 'digest')),
  status     text not null check (status in ('sent', 'failed')),
  recipients text[] not null,
  subject    text not null,
  alert_ids  bigint[] not null default '{}',
  digest_day date,
  error      text,
  sent_at    timestamptz not null default now()
);
create unique index notification_log_one_digest_per_day on public.notification_log (digest_day) where kind = 'digest' and status = 'sent';

do $$
declare t text;
begin
  foreach t in array array['notification_settings', 'notification_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_admin_all', t
    );
  end loop;
end $$;

alter publication supabase_realtime add table public.notification_settings;

-- ─── Health evaluation ───────────────────────────────────────────────────────
create or replace function private.fmt_phone(e164 text)
returns text language sql immutable set search_path = '' as $$
  select case when e164 ~ '^\+1\d{10}$'
    then '(' || substr(e164, 3, 3) || ') ' || substr(e164, 6, 3) || '-' || substr(e164, 9, 4)
    else e164 end;
$$;

create or replace function private.evaluate_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p           jsonb;
  v_today     date := (now() at time zone 'America/New_York')::date;
  min_rate    numeric;
  max_short   numeric;
  max_drop    numeric;
  spike_608   int;
  soft_drop   numeric;
  soft_short  numeric;
  v_opened    int := 0;
  v_refreshed int := 0;
  v_resolved  int := 0;
begin
  select settings into p from public.policies where is_active;
  min_rate   := coalesce((p #>> '{hardCool,minAnswerRate3d}')::numeric, 0.08);
  max_short  := coalesce((p #>> '{hardCool,maxShortCallPct}')::numeric, 0.30);
  max_drop   := coalesce((p #>> '{hardCool,maxDropPct}')::numeric, 0.03);
  spike_608  := coalesce((p #>> '{hardCool,sip608Spike}')::int, 5);
  soft_drop  := coalesce((p #>> '{softCool,answerRateDropPts}')::numeric, 0.05);
  soft_short := coalesce((p #>> '{softCool,shortCallPctFrom}')::numeric, 0.20);

  drop table if exists _found;
  drop table if exists _w3;
  create temp table _found (
    dedupe_key text primary key,
    kind       text not null,
    severity   public.alert_severity not null,
    did_id     uuid,
    message    text not null,
    details    jsonb
  ) on commit drop;

  -- Per-number 3-day window (today + 2 previous dialer days), skipping retired numbers.
  create temp table _w3 on commit drop as
  select d.id as did_id, d.e164,
         coalesce(sum(s.calls), 0)::numeric                                      as calls,
         coalesce(sum(s.answered), 0)::numeric                                   as answered,
         coalesce(sum(round(coalesce(s.short_call_pct, 0) * s.answered)), 0)::numeric as short_calls,
         coalesce(sum(s.drops), 0)::numeric                                      as drops,
         coalesce(sum(s.sip_608), 0)::int                                        as sip608
    from public.dids d
    left join public.did_stats_daily s on s.did_id = d.id and s.day > v_today - 3
   where d.lifecycle <> 'RETIRED'
   group by d.id, d.e164;

  insert into _found
  select 'answer_rate_low:' || did_id, 'answer_rate_low', 'critical', did_id,
         private.fmt_phone(e164) || ': answer rate ' || round(answered / calls * 100, 1) || '% over 3 days (below ' || round(min_rate * 100) || '%)',
         jsonb_build_object('calls', calls, 'answered', answered, 'threshold', min_rate)
    from _w3 where calls >= 20 and answered / calls < min_rate;

  insert into _found
  select 'short_calls_high:' || did_id, 'short_calls_high', 'critical', did_id,
         private.fmt_phone(e164) || ': ' || round(short_calls / answered * 100, 1) || '% of answered calls under 6 seconds (above ' || round(max_short * 100) || '%)',
         jsonb_build_object('answered', answered, 'short_calls', short_calls, 'threshold', max_short)
    from _w3 where answered >= 10 and short_calls / answered > max_short;

  insert into _found
  select 'short_calls_rising:' || did_id, 'short_calls_rising', 'warning', did_id,
         private.fmt_phone(e164) || ': ' || round(short_calls / answered * 100, 1) || '% short calls over 3 days (watch above ' || round(soft_short * 100) || '%)',
         jsonb_build_object('answered', answered, 'short_calls', short_calls, 'threshold', soft_short)
    from _w3 where answered >= 10 and short_calls / answered > soft_short and short_calls / answered <= max_short;

  insert into _found
  select 'drop_rate_high:' || did_id, 'drop_rate_high', 'critical', did_id,
         private.fmt_phone(e164) || ': ' || round(drops / answered * 100, 1) || '% of answered calls dropped over 3 days (above ' || round(max_drop * 100) || '%)',
         jsonb_build_object('answered', answered, 'drops', drops, 'threshold', max_drop)
    from _w3 where answered >= 20 and drops / answered > max_drop;

  insert into _found
  select 'sip_608_spike:' || did_id, 'sip_608_spike', 'critical', did_id,
         private.fmt_phone(e164) || ': ' || sip608 || ' calls rejected by carriers (SIP 608) over 3 days, a likely spam block',
         jsonb_build_object('sip_608', sip608, 'threshold', spike_608)
    from _w3 where sip608 >= spike_608;

  -- Week-over-week answer-rate drop.
  insert into _found
  select 'answer_rate_drop:' || x.did_id, 'answer_rate_drop', 'warning', x.did_id,
         private.fmt_phone(x.e164) || ': answer rate fell from ' || round(x.prev_rate * 100, 1) || '% to ' || round(x.cur_rate * 100, 1) || '% week over week',
         jsonb_build_object('previous', x.prev_rate, 'current', x.cur_rate, 'threshold_pts', soft_drop)
    from (
      select d.id as did_id, d.e164,
             sum(s.answered) filter (where s.day > v_today - 7)::numeric / nullif(sum(s.calls) filter (where s.day > v_today - 7), 0) as cur_rate,
             sum(s.answered) filter (where s.day <= v_today - 7)::numeric / nullif(sum(s.calls) filter (where s.day <= v_today - 7), 0) as prev_rate,
             coalesce(sum(s.calls) filter (where s.day > v_today - 7), 0) as cur_calls,
             coalesce(sum(s.calls) filter (where s.day <= v_today - 7), 0) as prev_calls
        from public.dids d
        join public.did_stats_daily s on s.did_id = d.id and s.day > v_today - 14
       where d.lifecycle <> 'RETIRED'
       group by d.id, d.e164
    ) x
   where x.cur_calls >= 50 and x.prev_calls >= 50 and x.prev_rate - x.cur_rate > soft_drop;

  -- Spam label on the latest reputation check within 7 days.
  insert into _found
  select 'spam_label:' || r.did_id, 'spam_label', 'critical', r.did_id,
         private.fmt_phone(d.e164) || ': labeled "' || replace(r.label::text, '_', ' ') || '" by ' || r.source,
         jsonb_build_object('source', r.source, 'label', r.label, 'checked_at', r.checked_at)
    from (
      select distinct on (did_id) did_id, source, label, checked_at
        from public.reputation_checks
       where checked_at > now() - interval '7 days'
       order by did_id, checked_at desc
    ) r
    join public.dids d on d.id = r.did_id and d.lifecycle <> 'RETIRED'
   where r.label in ('spam_likely', 'scam_likely', 'blocked');

  -- Dialer agent stopped syncing (agent runs every 15 minutes).
  insert into _found
  select 'sync_stale:' || name, 'sync_stale', 'critical', null,
         'Dialer ' || name || ' has not synced for ' || floor(extract(epoch from now() - last_heartbeat_at) / 60) || ' minutes',
         jsonb_build_object('last_heartbeat_at', last_heartbeat_at)
    from public.dialers
   where last_heartbeat_at < now() - interval '20 minutes' and status <> 'stopped';

  -- Pool-wide 30-day drop rate (legal limit 3%).
  insert into _found
  select 'pool_drop_rate', 'pool_drop_rate', 'critical', null,
         'Pool drop rate is ' || round(t.drops / t.answered * 100, 2) || '% over 30 days (limit 3%, alert above 2.5%)',
         jsonb_build_object('answered', t.answered, 'drops', t.drops)
    from (
      select coalesce(sum(answered), 0)::numeric as answered, coalesce(sum(drops), 0)::numeric as drops
        from public.did_stats_daily where day > v_today - 30
    ) t
   where t.answered >= 100 and t.drops / t.answered > 0.025;

  -- A state that had working numbers but has none dialable now.
  insert into _found
  select 'state_uncovered:' || state, 'state_uncovered', 'warning', null,
         state || ' has no numbers able to dial (all resting, retired or held)',
         jsonb_build_object('state', state)
    from public.dids
   where state is not null
   group by state
  having count(*) filter (where lifecycle in ('WARMING', 'ACTIVE') and not manual_hold) = 0
     and count(*) filter (where lifecycle in ('COOLING', 'RETIRED') or manual_hold) > 0;

  -- Refresh alerts that are still open.
  update public.alerts a
     set message = f.message, details = f.details, severity = f.severity, last_seen_at = now()
    from _found f
   where a.dedupe_key = f.dedupe_key and a.resolved_at is null;
  get diagnostics v_refreshed = row_count;

  -- Open new alerts.
  insert into public.alerts (kind, severity, did_id, message, details, dedupe_key, last_seen_at)
  select f.kind, f.severity, f.did_id, f.message, f.details, f.dedupe_key, now()
    from _found f
   where not exists (select 1 from public.alerts a where a.dedupe_key = f.dedupe_key and a.resolved_at is null);
  get diagnostics v_opened = row_count;

  -- Auto-resolve alerts whose condition cleared.
  update public.alerts a
     set resolved_at = now(), resolved_by = 'auto'
   where a.resolved_at is null
     and a.dedupe_key is not null
     and not exists (select 1 from _found f where f.dedupe_key = a.dedupe_key);
  get diagnostics v_resolved = row_count;

  return jsonb_build_object('opened', v_opened, 'refreshed', v_refreshed, 'resolved', v_resolved, 'evaluated_at', now());
end;
$$;

revoke all on function private.evaluate_health() from public, anon, authenticated;
revoke all on function private.fmt_phone(text) from public, anon;

-- Admins can trigger a check on demand from the app ("Run checks now").
create or replace function public.run_health_checks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'admin with MFA required' using errcode = '42501';
  end if;
  return private.evaluate_health();
end;
$$;
revoke all on function public.run_health_checks() from public, anon;
grant execute on function public.run_health_checks() to authenticated;

-- ─── Cron secret for the notify Edge Function ────────────────────────────────
-- Stored in Vault; the Edge Function asks the database whether a presented secret matches.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'udc_cron_secret', 'Shared secret for pg_cron -> alerts-notify Edge Function');

create or replace function public.udc_cron_secret_matches(presented text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'udc_cron_secret' and decrypted_secret = presented);
$$;
revoke all on function public.udc_cron_secret_matches(text) from public, anon, authenticated;
grant execute on function public.udc_cron_secret_matches(text) to service_role;

-- ─── Schedules ───────────────────────────────────────────────────────────────
-- Requires a Vault secret named 'udc_project_url' (e.g. https://<project-ref>.supabase.co), created once per project:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'udc_project_url');
select cron.schedule('udc-evaluate-health', '*/15 * * * *', $$ select private.evaluate_health(); $$);

select cron.schedule(
  'udc-alerts-notify',
  '2-59/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'udc_project_url') || '/functions/v1/alerts-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'udc_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
