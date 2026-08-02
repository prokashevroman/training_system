-- 0012_grants.sql
--
-- Table-level privileges for the Supabase roles.
--
-- This migration exists because RLS policies alone grant nothing. Policies
-- decide which ROWS a role may see; GRANTs decide whether it may touch the
-- TABLE at all. Without both, every policy in 0010 is unreachable.
--
-- It is needed explicitly because current Supabase sets the default ACL for
-- tables created by `postgres` in `public` to:
--
--     anon=Dxt, authenticated=Dxt, service_role=Dxt
--
-- that is TRUNCATE, REFERENCES and TRIGGER but no SELECT/INSERT/UPDATE/DELETE.
-- New tables are therefore unreachable until granted, which is a safe default
-- and the reason a fresh `supabase db reset` produced
-- "permission denied for table import_batches" on the first import run.
--
-- The split below mirrors 0010:
--   user-owned tables  -> full DML for `authenticated`, rows scoped by RLS
--   reference tables   -> read-only for `anon` and `authenticated`
--   service_role       -> full DML everywhere (it also bypasses RLS, which is
--                         why only the importer on a trusted machine uses it)

grant usage on schema public to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- User-owned tables. RLS (migration 0010) narrows every one of these to
-- `user_id = auth.uid()`, so a broad DML grant here is still per-user in
-- effect for `authenticated`.
-- --------------------------------------------------------------------------

grant select, insert, update, delete on
    public.profiles,
    public.workout_sessions,
    public.activities,
    public.strength_sets,
    public.cardio_intervals,
    public.circuit_results,
    public.circuit_movements,
    public.benchmark_results,
    public.benchmark_splits,
    public.daily_checkins,
    public.body_measurements,
    public.tags,
    public.session_tags,
    public.activity_tags,
    public.import_batches,
    public.import_entries,
    public.import_entry_sessions,
    public.ai_runs,
    public.user_corrections
to authenticated;

-- --------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, writable by nobody. There
-- is deliberately no insert/update/delete grant, so the exercise library can
-- only change through a migration or the seed.
-- --------------------------------------------------------------------------

grant select on
    public.exercises,
    public.exercise_aliases,
    public.benchmark_definitions
to anon, authenticated;

-- --------------------------------------------------------------------------
-- service_role: used only by the workbook importer, from a trusted machine.
-- --------------------------------------------------------------------------

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- The importer's transactional entry point. It is SECURITY INVOKER, so this
-- grant does not widen what the caller may do — it only lets them call it.
grant execute on function public.apply_import_entry(uuid, uuid, jsonb, jsonb)
    to service_role, authenticated;
