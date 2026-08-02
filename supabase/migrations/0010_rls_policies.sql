-- 0010_rls_policies.sql
--
-- Row-level security for every table in the schema. Nothing is left open: a
-- table with RLS enabled and no matching policy denies by default, which is the
-- behaviour we want for the reference tables' writes.
--
-- THE PAYOFF OF THE COMPOSITE-FK DESIGN:
--
-- Every one of the nineteen user-owned tables gets the same four policies with
-- the same predicate — `user_id = auth.uid()`. No joins, no `exists (select 1
-- from ... where ...)` walk up the parent chain, no recursive policy evaluation,
-- and every predicate is served by the `<table>_user_id_idx` created alongside
-- the table. A leaf `benchmark_splits` row is checked exactly as cheaply as a
-- `workout_sessions` row, four levels up.
--
-- The denormalized user_id that makes this possible cannot drift, because each
-- child reaches its parent through `(parent_id, user_id)` against the parent's
-- `unique (id, user_id)`. Postgres refuses a mismatched row outright, so the
-- flat predicate is not a shortcut that trusts the application — it is
-- equivalent to walking the chain, by construction.
--
-- `to authenticated` on every policy keeps the anon key out entirely. The
-- service role bypasses RLS, which is how seeds and the importer write
-- reference data.
--
-- One policy per operation, `using` for select/update/delete, `with check` for
-- insert/update. On update both appear: `using` decides which rows may be
-- targeted, `with check` prevents rewriting user_id to someone else's id.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
    for select to authenticated
    using (user_id = auth.uid());

create policy profiles_insert_own on public.profiles
    for insert to authenticated
    with check (user_id = auth.uid());

create policy profiles_update_own on public.profiles
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy profiles_delete_own on public.profiles
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Global reference data: readable by every authenticated user, writable by none.
--
-- No insert/update/delete policy is created on purpose. RLS is enabled, so the
-- absence of a policy is itself the denial — these tables change only through a
-- migration or the service role.
-- ---------------------------------------------------------------------------

alter table public.exercises enable row level security;

create policy exercises_select_authenticated on public.exercises
    for select to authenticated
    using (true);

alter table public.exercise_aliases enable row level security;

create policy exercise_aliases_select_authenticated on public.exercise_aliases
    for select to authenticated
    using (true);

alter table public.benchmark_definitions enable row level security;

create policy benchmark_definitions_select_authenticated on public.benchmark_definitions
    for select to authenticated
    using (true);

-- ---------------------------------------------------------------------------
-- workout_sessions
-- ---------------------------------------------------------------------------

alter table public.workout_sessions enable row level security;

create policy workout_sessions_select_own on public.workout_sessions
    for select to authenticated
    using (user_id = auth.uid());

create policy workout_sessions_insert_own on public.workout_sessions
    for insert to authenticated
    with check (user_id = auth.uid());

create policy workout_sessions_update_own on public.workout_sessions
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy workout_sessions_delete_own on public.workout_sessions
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------------

alter table public.activities enable row level security;

create policy activities_select_own on public.activities
    for select to authenticated
    using (user_id = auth.uid());

create policy activities_insert_own on public.activities
    for insert to authenticated
    with check (user_id = auth.uid());

create policy activities_update_own on public.activities
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy activities_delete_own on public.activities
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- strength_sets
-- ---------------------------------------------------------------------------

alter table public.strength_sets enable row level security;

create policy strength_sets_select_own on public.strength_sets
    for select to authenticated
    using (user_id = auth.uid());

create policy strength_sets_insert_own on public.strength_sets
    for insert to authenticated
    with check (user_id = auth.uid());

create policy strength_sets_update_own on public.strength_sets
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy strength_sets_delete_own on public.strength_sets
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- cardio_intervals
-- ---------------------------------------------------------------------------

alter table public.cardio_intervals enable row level security;

create policy cardio_intervals_select_own on public.cardio_intervals
    for select to authenticated
    using (user_id = auth.uid());

create policy cardio_intervals_insert_own on public.cardio_intervals
    for insert to authenticated
    with check (user_id = auth.uid());

create policy cardio_intervals_update_own on public.cardio_intervals
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy cardio_intervals_delete_own on public.cardio_intervals
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- circuit_results
-- ---------------------------------------------------------------------------

alter table public.circuit_results enable row level security;

create policy circuit_results_select_own on public.circuit_results
    for select to authenticated
    using (user_id = auth.uid());

create policy circuit_results_insert_own on public.circuit_results
    for insert to authenticated
    with check (user_id = auth.uid());

create policy circuit_results_update_own on public.circuit_results
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy circuit_results_delete_own on public.circuit_results
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- circuit_movements
-- ---------------------------------------------------------------------------

alter table public.circuit_movements enable row level security;

create policy circuit_movements_select_own on public.circuit_movements
    for select to authenticated
    using (user_id = auth.uid());

create policy circuit_movements_insert_own on public.circuit_movements
    for insert to authenticated
    with check (user_id = auth.uid());

create policy circuit_movements_update_own on public.circuit_movements
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy circuit_movements_delete_own on public.circuit_movements
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- benchmark_results
-- ---------------------------------------------------------------------------

alter table public.benchmark_results enable row level security;

create policy benchmark_results_select_own on public.benchmark_results
    for select to authenticated
    using (user_id = auth.uid());

create policy benchmark_results_insert_own on public.benchmark_results
    for insert to authenticated
    with check (user_id = auth.uid());

create policy benchmark_results_update_own on public.benchmark_results
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy benchmark_results_delete_own on public.benchmark_results
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- benchmark_splits
-- ---------------------------------------------------------------------------

alter table public.benchmark_splits enable row level security;

create policy benchmark_splits_select_own on public.benchmark_splits
    for select to authenticated
    using (user_id = auth.uid());

create policy benchmark_splits_insert_own on public.benchmark_splits
    for insert to authenticated
    with check (user_id = auth.uid());

create policy benchmark_splits_update_own on public.benchmark_splits
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy benchmark_splits_delete_own on public.benchmark_splits
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- daily_checkins
-- ---------------------------------------------------------------------------

alter table public.daily_checkins enable row level security;

create policy daily_checkins_select_own on public.daily_checkins
    for select to authenticated
    using (user_id = auth.uid());

create policy daily_checkins_insert_own on public.daily_checkins
    for insert to authenticated
    with check (user_id = auth.uid());

create policy daily_checkins_update_own on public.daily_checkins
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy daily_checkins_delete_own on public.daily_checkins
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- body_measurements
-- ---------------------------------------------------------------------------

alter table public.body_measurements enable row level security;

create policy body_measurements_select_own on public.body_measurements
    for select to authenticated
    using (user_id = auth.uid());

create policy body_measurements_insert_own on public.body_measurements
    for insert to authenticated
    with check (user_id = auth.uid());

create policy body_measurements_update_own on public.body_measurements
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy body_measurements_delete_own on public.body_measurements
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

alter table public.tags enable row level security;

create policy tags_select_own on public.tags
    for select to authenticated
    using (user_id = auth.uid());

create policy tags_insert_own on public.tags
    for insert to authenticated
    with check (user_id = auth.uid());

create policy tags_update_own on public.tags
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy tags_delete_own on public.tags
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- session_tags
-- ---------------------------------------------------------------------------

alter table public.session_tags enable row level security;

create policy session_tags_select_own on public.session_tags
    for select to authenticated
    using (user_id = auth.uid());

create policy session_tags_insert_own on public.session_tags
    for insert to authenticated
    with check (user_id = auth.uid());

create policy session_tags_update_own on public.session_tags
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy session_tags_delete_own on public.session_tags
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- activity_tags
-- ---------------------------------------------------------------------------

alter table public.activity_tags enable row level security;

create policy activity_tags_select_own on public.activity_tags
    for select to authenticated
    using (user_id = auth.uid());

create policy activity_tags_insert_own on public.activity_tags
    for insert to authenticated
    with check (user_id = auth.uid());

create policy activity_tags_update_own on public.activity_tags
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy activity_tags_delete_own on public.activity_tags
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- import_batches
-- ---------------------------------------------------------------------------

alter table public.import_batches enable row level security;

create policy import_batches_select_own on public.import_batches
    for select to authenticated
    using (user_id = auth.uid());

create policy import_batches_insert_own on public.import_batches
    for insert to authenticated
    with check (user_id = auth.uid());

create policy import_batches_update_own on public.import_batches
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy import_batches_delete_own on public.import_batches
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- import_entries
-- ---------------------------------------------------------------------------

alter table public.import_entries enable row level security;

create policy import_entries_select_own on public.import_entries
    for select to authenticated
    using (user_id = auth.uid());

create policy import_entries_insert_own on public.import_entries
    for insert to authenticated
    with check (user_id = auth.uid());

create policy import_entries_update_own on public.import_entries
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy import_entries_delete_own on public.import_entries
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- import_entry_sessions
-- ---------------------------------------------------------------------------

alter table public.import_entry_sessions enable row level security;

create policy import_entry_sessions_select_own on public.import_entry_sessions
    for select to authenticated
    using (user_id = auth.uid());

create policy import_entry_sessions_insert_own on public.import_entry_sessions
    for insert to authenticated
    with check (user_id = auth.uid());

create policy import_entry_sessions_update_own on public.import_entry_sessions
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy import_entry_sessions_delete_own on public.import_entry_sessions
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ai_runs
-- ---------------------------------------------------------------------------

alter table public.ai_runs enable row level security;

create policy ai_runs_select_own on public.ai_runs
    for select to authenticated
    using (user_id = auth.uid());

create policy ai_runs_insert_own on public.ai_runs
    for insert to authenticated
    with check (user_id = auth.uid());

create policy ai_runs_update_own on public.ai_runs
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy ai_runs_delete_own on public.ai_runs
    for delete to authenticated
    using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- user_corrections
-- ---------------------------------------------------------------------------

alter table public.user_corrections enable row level security;

create policy user_corrections_select_own on public.user_corrections
    for select to authenticated
    using (user_id = auth.uid());

create policy user_corrections_insert_own on public.user_corrections
    for insert to authenticated
    with check (user_id = auth.uid());

create policy user_corrections_update_own on public.user_corrections
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy user_corrections_delete_own on public.user_corrections
    for delete to authenticated
    using (user_id = auth.uid());
