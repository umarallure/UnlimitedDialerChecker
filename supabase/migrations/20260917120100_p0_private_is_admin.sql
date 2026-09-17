-- is_admin() is only needed inside RLS policies, so keep it out of the exposed API schema.
-- Policies reference the function by OID and keep working after the move.
-- is_listed_admin() stays public: the app calls it via RPC to route users to /mfa or /not-authorized.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_admin() set schema private;
