-- P3 · Rotation: every run of the lifecycle engine and the changes it proposed.
-- In dry run nothing is applied; the rows are the record of what *would* have happened.
-- In enforce mode the agent applies each proposal and marks it applied.

create table public.lifecycle_runs (
  id              uuid primary key default gen_random_uuid(),
  mode            public.enforcement_mode not null,
  triggered_by    text not null,
  dids_evaluated  integer not null default 0,
  dids_skipped    integer not null default 0,
  proposals       integer not null default 0,
  applied         integer not null default 0,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index lifecycle_runs_recent_idx on public.lifecycle_runs (started_at desc);

create table public.lifecycle_proposals (
  id                   bigint generated always as identity primary key,
  run_id               uuid not null references public.lifecycle_runs (id) on delete cascade,
  did_id               uuid not null references public.dids (id) on delete cascade,
  kind                 text not null check (kind in ('promote', 'cool', 'retire', 'warmup', 'cap')),
  from_state           public.did_lifecycle not null,
  to_state             public.did_lifecycle,
  warmup_week          smallint not null default 0,
  proposed_warmup_week smallint not null default 0,
  current_cap          integer not null default 0,
  proposed_cap         integer not null default 0,
  reason               text not null,
  metrics              jsonb,
  applied              boolean not null default false,
  created_at           timestamptz not null default now()
);
create index lifecycle_proposals_run_idx on public.lifecycle_proposals (run_id);
create index lifecycle_proposals_did_idx on public.lifecycle_proposals (did_id, created_at desc);

-- ─── RLS: admin-only, same rules as every other table ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['lifecycle_runs', 'lifecycle_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- The last run per mode, for the Rotation page header.
create or replace view public.lifecycle_last_run
with (security_invoker = true) as
select distinct on (mode) id, mode, triggered_by, dids_evaluated, dids_skipped, proposals, applied, error, started_at, finished_at
  from public.lifecycle_runs
 order by mode, started_at desc;
