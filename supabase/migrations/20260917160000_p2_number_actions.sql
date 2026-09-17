-- P2 · Number actions and setup checklist.
-- One RPC applies an action to one or many numbers atomically and records every change
-- in did_state_events with the admin who made it.

alter table public.dids
  add column cap_override       integer check (cap_override is null or cap_override between 0 and 500),
  add column callback_verified_at timestamptz,
  add column attestation_verified_at timestamptz;

-- Backfill: numbers already marked with a working callback route.
update public.dids set callback_verified_at = updated_at where inbound_route_ok and callback_verified_at is null;

create or replace function public.did_action(p_ids uuid[], p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text := coalesce((select auth.jwt()) ->> 'email', 'admin');
  v_reason  text := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  v_count   int := 0;
  r         record;
  v_note    text;
begin
  if not (select private.is_admin()) then
    raise exception 'admin with MFA required' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'choose at least one number' using errcode = '22023';
  end if;
  if array_length(p_ids, 1) > 1000 then
    raise exception 'at most 1000 numbers per action' using errcode = '22023';
  end if;

  for r in select * from public.dids where id = any (p_ids) for update loop
    v_note := null;

    case p_action
      when 'set_fcr' then
        if (p_payload ->> 'value')::boolean then
          update public.dids set fcr_registered_at = coalesce(fcr_registered_at, now()) where id = r.id;
          v_note := 'Marked registered on Free Caller Registry';
        else
          update public.dids set fcr_registered_at = null where id = r.id;
          v_note := 'Cleared Free Caller Registry registration';
        end if;

      when 'set_callback' then
        if (p_payload ->> 'value')::boolean then
          update public.dids set inbound_route_ok = true, callback_verified_at = coalesce(callback_verified_at, now()) where id = r.id;
          v_note := 'Callback route verified';
        else
          update public.dids set inbound_route_ok = false, callback_verified_at = null where id = r.id;
          v_note := 'Callback route marked not working';
        end if;

      when 'set_attestation' then
        if coalesce(p_payload ->> 'value', '') not in ('A', 'B', 'C', '') then
          raise exception 'attestation must be A, B or C' using errcode = '22023';
        end if;
        update public.dids
           set attestation = nullif(p_payload ->> 'value', ''),
               attestation_verified_at = case when nullif(p_payload ->> 'value', '') is null then null else now() end
         where id = r.id;
        v_note := coalesce('Attestation confirmed as ' || nullif(p_payload ->> 'value', ''), 'Attestation cleared');

      when 'set_cnam' then
        update public.dids set cnam = nullif(left(btrim(coalesce(p_payload ->> 'value', '')), 15), '') where id = r.id;
        v_note := coalesce('CNAM set to ' || nullif(left(btrim(coalesce(p_payload ->> 'value', '')), 15), ''), 'CNAM cleared');

      when 'set_notes' then
        update public.dids set notes = nullif(left(btrim(coalesce(p_payload ->> 'value', '')), 500), '') where id = r.id;
        -- Notes are not lifecycle-relevant; no history entry.

      when 'set_cap_override' then
        if p_payload ->> 'value' is not null and ((p_payload ->> 'value')::int < 0 or (p_payload ->> 'value')::int > 500) then
          raise exception 'daily cap must be between 0 and 500' using errcode = '22023';
        end if;
        update public.dids set cap_override = (p_payload ->> 'value')::int where id = r.id;
        v_note := coalesce('Daily cap override set to ' || (p_payload ->> 'value'), 'Daily cap override removed');

      when 'hold' then
        if r.manual_hold then continue; end if;
        update public.dids set manual_hold = true, manual_hold_reason = v_reason where id = r.id;
        v_note := 'Held' || coalesce(': ' || v_reason, '');

      when 'release' then
        if not r.manual_hold then continue; end if;
        update public.dids set manual_hold = false, manual_hold_reason = null where id = r.id;
        v_note := 'Released from hold' || coalesce(': ' || v_reason, '');

      when 'force_cool' then
        if r.lifecycle not in ('WARMING', 'ACTIVE') then continue; end if;
        update public.dids set lifecycle = 'COOLING', lifecycle_since = now() where id = r.id;
        insert into public.did_state_events (did_id, from_state, to_state, reason, actor)
        values (r.id, r.lifecycle, 'COOLING', 'Manual cool-off' || coalesce(': ' || v_reason, ''), v_actor);
        v_count := v_count + 1;
        continue;

      when 'restart_warmup' then
        if r.lifecycle not in ('COOLING', 'NEW') then continue; end if;
        update public.dids set lifecycle = 'WARMING', lifecycle_since = now(), warmup_week = 1 where id = r.id;
        insert into public.did_state_events (did_id, from_state, to_state, reason, actor)
        values (r.id, r.lifecycle, 'WARMING', 'Manual start of warm-up' || coalesce(': ' || v_reason, ''), v_actor);
        v_count := v_count + 1;
        continue;

      when 'retire' then
        if r.lifecycle = 'RETIRED' then continue; end if;
        if v_reason is null then
          raise exception 'a reason is required to retire a number' using errcode = '22023';
        end if;
        update public.dids set lifecycle = 'RETIRED', lifecycle_since = now(), manual_hold = false, manual_hold_reason = null where id = r.id;
        insert into public.did_state_events (did_id, from_state, to_state, reason, actor)
        values (r.id, r.lifecycle, 'RETIRED', 'Retired: ' || v_reason, v_actor);
        v_count := v_count + 1;
        continue;

      else
        raise exception 'unknown action %', p_action using errcode = '22023';
    end case;

    if v_note is not null then
      insert into public.did_state_events (did_id, from_state, to_state, reason, actor)
      values (r.id, r.lifecycle, r.lifecycle, v_note, v_actor);
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('action', p_action, 'changed', v_count, 'requested', array_length(p_ids, 1));
end;
$$;

revoke all on function public.did_action(uuid[], text, jsonb) from public, anon;
grant execute on function public.did_action(uuid[], text, jsonb) to authenticated;
