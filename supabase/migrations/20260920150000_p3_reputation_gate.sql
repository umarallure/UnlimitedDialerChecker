-- P3 · Reputation gate as a setting.
-- The engine will not let a number start warming until a scan says it is clean. No reputation
-- provider is connected yet, so the pool would sit in aging for ever. Turn the gate off for now;
-- it goes back on from Settings → Rotation the day My Call Score is wired up.
-- A number with a known bad label is still held back either way.

update public.policies
   set settings = settings || jsonb_build_object('requireCleanReputation', false),
       updated_by = 'migration:reputation-gate-off'
 where is_active;
