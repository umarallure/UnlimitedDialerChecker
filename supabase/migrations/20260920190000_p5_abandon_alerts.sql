-- P5 · Alert when a campaign's abandoned calls approach or pass the 3% daily limit.
--
-- The checks have to live inside evaluate_health(): it resolves any open alert whose
-- dedupe_key it does not re-find, so a campaign alert raised anywhere else would be closed
-- again on the next run.
--
-- Only the two blocks marked "P5" are new; the rest is unchanged from the P2 function.

create or replace function private.evaluate_health()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  p           jsonb;
  v_today     date := (now() at time zone 'America/New_York')::date;
  min_rate    numeric;
  max_short   numeric;
  max_drop    numeric;
  spike_608   int;
  soft_drop   numeric;
  soft_short  numeric;
  abandon_cap numeric := 0.03;  -- P5: Telemarketing Sales Rule, per campaign per day
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

  insert into _found
  select 'sync_stale:' || name, 'sync_stale', 'critical', null,
         'Dialer ' || name || ' has not synced for ' || floor(extract(epoch from now() - last_heartbeat_at) / 60) || ' minutes',
         jsonb_build_object('last_heartbeat_at', last_heartbeat_at)
    from public.dialers
   where last_heartbeat_at < now() - interval '20 minutes' and status <> 'stopped';

  insert into _found
  select 'pool_drop_rate', 'pool_drop_rate', 'critical', null,
         'Pool drop rate is ' || round(t.drops / t.answered * 100, 2) || '% over 30 days (limit 3%, alert above 2.5%)',
         jsonb_build_object('answered', t.answered, 'drops', t.drops)
    from (
      select coalesce(sum(answered), 0)::numeric as answered, coalesce(sum(drops), 0)::numeric as drops
        from public.did_stats_daily where day > v_today - 30
    ) t
   where t.answered >= 100 and t.drops / t.answered > 0.025;

  insert into _found
  select 'state_uncovered:' || state, 'state_uncovered', 'warning', null,
         state || ' has no numbers able to dial (all resting, retired or held)',
         jsonb_build_object('state', state)
    from public.dids
   where state is not null
   group by state
  having count(*) filter (where lifecycle in ('WARMING', 'ACTIVE') and not manual_hold) = 0
     and count(*) filter (where lifecycle in ('COOLING', 'RETIRED') or manual_hold) > 0;

  -- P5: a campaign past the daily abandoned-call limit. Measured against calls a person
  -- answered, and only once 20 have been answered, so a slow start cannot trip it.
  insert into _found
  select 'abandon_rate:' || c.campaign_id, 'abandon_rate', 'critical', null,
         c.campaign_id || ': ' || round(c.drops::numeric * 100 / (c.connected + c.drops), 1)
           || '% of answered calls abandoned today, above the ' || round(abandon_cap * 100) || '% limit ('
           || c.drops || ' of ' || (c.connected + c.drops) || ')',
         jsonb_build_object('campaign_id', c.campaign_id, 'connected', c.connected, 'drops', c.drops, 'cap', abandon_cap)
    from public.campaign_stats_daily c
   where c.day = v_today
     and c.connected + c.drops >= 20
     and c.drops::numeric / (c.connected + c.drops) > abandon_cap;

  -- P5: approaching the limit, while there is still time to pace down. The rate is a whole-day
  -- average, so a bad hour can only be diluted afterwards, never undone.
  insert into _found
  select 'abandon_rate_near:' || c.campaign_id, 'abandon_rate_near', 'warning', null,
         c.campaign_id || ': ' || round(c.drops::numeric * 100 / (c.connected + c.drops), 1)
           || '% of answered calls abandoned today, nearing the ' || round(abandon_cap * 100) || '% limit',
         jsonb_build_object('campaign_id', c.campaign_id, 'connected', c.connected, 'drops', c.drops, 'cap', abandon_cap)
    from public.campaign_stats_daily c
   where c.day = v_today
     and c.connected + c.drops >= 20
     and c.drops::numeric / (c.connected + c.drops) >= abandon_cap * 2 / 3
     and c.drops::numeric / (c.connected + c.drops) <= abandon_cap;

  update public.alerts a
     set message = f.message, details = f.details, severity = f.severity, last_seen_at = now()
    from _found f
   where a.dedupe_key = f.dedupe_key and a.resolved_at is null;
  get diagnostics v_refreshed = row_count;

  insert into public.alerts (kind, severity, did_id, message, details, dedupe_key, last_seen_at)
  select f.kind, f.severity, f.did_id, f.message, f.details, f.dedupe_key, now()
    from _found f
   where not exists (select 1 from public.alerts a where a.dedupe_key = f.dedupe_key and a.resolved_at is null);
  get diagnostics v_opened = row_count;

  update public.alerts a
     set resolved_at = now(), resolved_by = 'auto'
   where a.resolved_at is null
     and a.dedupe_key is not null
     and not exists (select 1 from _found f where f.dedupe_key = a.dedupe_key);
  get diagnostics v_resolved = row_count;

  return jsonb_build_object('opened', v_opened, 'refreshed', v_refreshed, 'resolved', v_resolved, 'evaluated_at', now());
end;
$function$;
