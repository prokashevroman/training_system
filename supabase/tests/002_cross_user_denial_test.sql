-- 002_cross_user_denial_test.sql
--
-- RLS denial across an ownership boundary, on PARENTS AND CHILDREN ALIKE.
--
-- A full chain is seeded for athlete A. The transaction then becomes athlete B
-- and asserts that not one of A's rows is readable, writable or deletable — not
-- at the top of the chain, and not four levels down at benchmark_splits.
--
-- The child-table half is the point of the file. Every policy in 0010 is the
-- flat `user_id = auth.uid()`, with no walk up the parent chain, so a leaf row
-- is only protected if it carries the right user_id. These assertions are what
-- makes the denormalized user_id design safe rather than merely convenient.
--
-- Self-contained: seeds its own users inside a transaction that is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures, written as the migration owner (RLS is bypassed here)
-- ---------------------------------------------------------------------------
-- user A  11111111-...  owns everything below
-- user B  22222222-...  owns nothing and must see nothing

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@pgtap.test', '', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@pgtap.test', '', now(), now(), now());

-- Reference data carries no user_id and is deliberately NOT part of the
-- isolation assertions below; it exists only so the chain can resolve.
insert into public.exercises (id, slug, name, movement_pattern)
values ('e0000000-0000-4000-8000-000000000002', 'pgtap-002-back-squat', 'pgTAP Back Squat', 'squat');

insert into public.benchmark_definitions (id, slug, name, scoring)
values ('d0000000-0000-4000-8000-000000000002', 'pgtap-002-murph', 'pgTAP Murph', 'time');

insert into public.profiles (user_id, display_name)
values ('11111111-1111-1111-1111-111111111111', 'Athlete A');

insert into public.workout_sessions (
    id, user_id, local_date, started_at, title, source, raw_text,
    duration_seconds, session_rpe, status, client_request_key
)
values (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '2026-06-15',
    '2026-06-15T06:30:00+00',
    'Squats, run, Cindy, Murph',
    'excel_import',
    'Back squat 5x100kg. 3.2 km run. 12 rounds cindy. Full Murph, finished at 39:56.',
    5400,
    9,
    'completed',
    'import:Training programm 2026:24:8:1'
);

insert into public.activities (id, user_id, session_id, sequence, modality, subtype, objective, intensity, duration_seconds, distance_km)
values
    ('20000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 1, 'strength', 'barbell', 'max_strength', 'hard', 1800, null),
    ('20000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 2, 'running', 'outdoor', 'aerobic_base', 'moderate', 1200, 3.2),
    ('20000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 3, 'hybrid_conditioning', null, 'hybrid_conditioning', 'hard', 1171, null),
    ('20000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 4, 'hybrid_conditioning', 'murph', 'race_specific', 'max', 2396, 3.2);

insert into public.strength_sets (
    id, user_id, activity_id, set_index, exercise_id, exercise_raw_text,
    exercise_confidence, set_type, reps, load_value, load_unit, load_scope, load_kg, original_text
)
values (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000001',
    1,
    'e0000000-0000-4000-8000-000000000002',
    'Back squat 5x100kg',
    1,
    'working',
    5,
    100,
    'kg',
    'total',
    100,
    'Back squat 5x100kg'
);

insert into public.cardio_intervals (
    id, user_id, activity_id, interval_index, interval_type,
    duration_seconds, distance_km, pace_seconds_per_km, heart_rate_bpm, original_text
)
values (
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000002',
    1,
    'work',
    1200,
    3.2,
    375,
    162,
    '3.2 km in 20 min'
);

insert into public.circuit_results (
    id, user_id, activity_id, format, name,
    rounds_prescribed, rounds_completed, completion_seconds, original_text
)
values (
    '50000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000003',
    'rounds',
    'Cindy',
    12,
    12,
    1171,
    '12 rounds cindy (19:31)'
);

insert into public.circuit_movements (
    id, user_id, circuit_result_id, movement_order, exercise_raw_text, target_reps, original_text
)
values (
    '60000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '50000000-0000-4000-8000-000000000001',
    1,
    '5 pull ups',
    5,
    '5 pull ups'
);

insert into public.benchmark_results (
    id, user_id, activity_id, definition_id, definition_slug, scoring,
    total_seconds, vest_kg, as_prescribed, original_text
)
values (
    '70000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000002',
    'pgtap-002-murph',
    'time',
    2396,
    9,
    true,
    'Full Murph, finished at 39:56'
);

insert into public.benchmark_splits (
    id, user_id, benchmark_result_id, split_order, label,
    elapsed_seconds, is_cumulative, reference_frame, original_text
)
values (
    '80000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '70000000-0000-4000-8000-000000000001',
    1,
    'run 1',
    537,
    false,
    'segment',
    'run 1 - 8:57'
);

insert into public.import_batches (
    id, user_id, file_name, file_sha256, sheet_name, importer_version, parser_version, status
)
values (
    'b0000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'Training programm 2026.xlsx',
    repeat('cd', 32),
    'Training programm 2026',
    'importer-0.1.0',
    'parser-0.1.0',
    'completed'
);

insert into public.import_entries (
    id, user_id, batch_id, sheet_name, source_row, source_col, cell_ref,
    week_label, inferred_local_date, raw_text, raw_text_sha256, review_status
)
values (
    'b0000000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'b0000000-0000-4000-8000-000000000001',
    'Training programm 2026',
    24,
    8,
    'R24C8',
    'Week 23 Jun 8 Jun 14',
    '2026-06-15',
    'Full Murph, finished at 39:56',
    repeat('ab', 32),
    'applied'
);

-- ---------------------------------------------------------------------------
-- 1. The chain exists before anyone is impersonated, so every zero asserted
-- below is a denial rather than an empty fixture.
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from (
            select user_id from public.profiles
            union all select user_id from public.workout_sessions
            union all select user_id from public.activities
            union all select user_id from public.strength_sets
            union all select user_id from public.cardio_intervals
            union all select user_id from public.circuit_results
            union all select user_id from public.circuit_movements
            union all select user_id from public.benchmark_results
            union all select user_id from public.benchmark_splits
            union all select user_id from public.import_batches
            union all select user_id from public.import_entries
        ) as chain
        where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    14,
    'the seeded chain for A is 14 rows across 11 tables'
);

-- ---------------------------------------------------------------------------
-- Become athlete B.
--
-- pgTAP keeps its counters in temp tables created by plan() above; the grants
-- below make them writable by the impersonated role, so the assertions that
-- follow report normally instead of failing on the bookkeeping. Harmless when
-- pgTAP has already granted them.
-- ---------------------------------------------------------------------------

do $$
declare
    rel record;
begin
    for rel in
        select n.nspname, c.relname, c.relkind
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.oid = pg_my_temp_schema()
          and c.relkind in ('r', 'S')
    loop
        begin
            if rel.relkind = 'r' then
                execute format('grant all on table %I.%I to authenticated', rel.nspname, rel.relname);
            else
                execute format('grant all on sequence %I.%I to authenticated', rel.nspname, rel.relname);
            end if;
        exception when others then
            null;
        end;
    end loop;
end
$$;

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 2-12. B reads nothing of A. Parents first, then every child level: this is
-- the assertion that validates the denormalized user_id.
-- ---------------------------------------------------------------------------

select is(
    (select count(*)::int from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the profile of A'
);

select is(
    (select count(*)::int from public.workout_sessions where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the workout_sessions of A'
);

select is(
    (select count(*)::int from public.activities where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the activities of A'
);

select is(
    (select count(*)::int from public.strength_sets where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the strength_sets of A'
);

select is(
    (select count(*)::int from public.cardio_intervals where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the cardio_intervals of A'
);

select is(
    (select count(*)::int from public.circuit_results where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the circuit_results of A'
);

select is(
    (select count(*)::int from public.circuit_movements where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the circuit_movements of A, two levels below the session'
);

select is(
    (select count(*)::int from public.benchmark_results where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the benchmark_results of A'
);

select is(
    (select count(*)::int from public.benchmark_splits where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the benchmark_splits of A, three levels below the session'
);

select is(
    (select count(*)::int from public.import_batches where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the import_batches of A'
);

select is(
    (select count(*)::int from public.import_entries where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'B cannot see the import_entries of A'
);

-- ---------------------------------------------------------------------------
-- 13. And nothing leaks through an aggregate either.
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from (
            select user_id from public.profiles
            union all select user_id from public.workout_sessions
            union all select user_id from public.activities
            union all select user_id from public.strength_sets
            union all select user_id from public.cardio_intervals
            union all select user_id from public.circuit_results
            union all select user_id from public.circuit_movements
            union all select user_id from public.benchmark_results
            union all select user_id from public.benchmark_splits
            union all select user_id from public.import_batches
            union all select user_id from public.import_entries
        ) as chain
        where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    0,
    'not one row of the 14-row chain of A is visible to B'
);

-- ---------------------------------------------------------------------------
-- 14-19. Writes by B against rows of A touch nothing. RLS filters the target
-- rows out, so these are silent no-ops rather than errors — which is exactly
-- why they have to be asserted.
-- ---------------------------------------------------------------------------

with upd as (
    update public.workout_sessions
       set title = 'hijacked by B'
     where id = '10000000-0000-4000-8000-000000000001'
    returning 1
)
select is((select count(*)::int from upd), 0, 'an update by B against the session of A affects zero rows');

with del as (
    delete from public.workout_sessions
     where id = '10000000-0000-4000-8000-000000000001'
    returning 1
)
select is((select count(*)::int from del), 0, 'a delete by B against the session of A affects zero rows');

with upd as (
    update public.strength_sets
       set reps = 1, load_kg = 1
     where id = '30000000-0000-4000-8000-000000000001'
    returning 1
)
select is((select count(*)::int from upd), 0, 'an update by B against a strength_set of A affects zero rows');

with upd as (
    update public.benchmark_splits
       set elapsed_seconds = 1
     where id = '80000000-0000-4000-8000-000000000001'
    returning 1
)
select is((select count(*)::int from upd), 0, 'an update by B against a benchmark_split of A affects zero rows');

with del as (
    delete from public.circuit_movements
     where id = '60000000-0000-4000-8000-000000000001'
    returning 1
)
select is((select count(*)::int from del), 0, 'a delete by B against a circuit_movement of A affects zero rows');

with del as (
    delete from public.import_entries
     where id = 'b0000000-0000-4000-8000-000000000002'
    returning 1
)
select is((select count(*)::int from del), 0, 'a delete by B against an import_entry of A affects zero rows');

-- ---------------------------------------------------------------------------
-- 20-23. B cannot write rows INTO the world of A either.
--
-- Two different refusals, and the difference matters: stamping the user_id of A
-- on a new row is refused by the RLS check (42501), while keeping the own
-- user_id of B and pointing at a parent of A is refused by the composite
-- foreign key (23503). Both doors are shut, one by policy and one by structure.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        insert into public.workout_sessions (user_id, local_date, title)
        values ('11111111-1111-1111-1111-111111111111', '2026-06-16', 'Planted by B')
    $$,
    '42501',
    'B cannot insert a workout_session owned by A'
);

select throws_ok(
    $$
        insert into public.activities (user_id, session_id, sequence, modality)
        values (
            '11111111-1111-1111-1111-111111111111',
            '10000000-0000-4000-8000-000000000001',
            9,
            'strength'
        )
    $$,
    '42501',
    'B cannot insert an activity owned by A into the session of A'
);

select throws_ok(
    $$
        insert into public.strength_sets (user_id, activity_id, set_index, exercise_raw_text)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000001',
            9,
            'Planted by B'
        )
    $$,
    '23503',
    'B cannot hang an own strength_set off an activity of A'
);

select throws_ok(
    $$
        insert into public.benchmark_splits (user_id, benchmark_result_id, split_order, label)
        values (
            '22222222-2222-2222-2222-222222222222',
            '70000000-0000-4000-8000-000000000001',
            9,
            'planted by B'
        )
    $$,
    '23503',
    'B cannot hang an own benchmark_split off a benchmark_result of A'
);

-- ---------------------------------------------------------------------------
-- 24-25. B may write its own rows, and may not hand them to A afterwards.
-- The `with check` half of the update policy is what forbids the second.
-- ---------------------------------------------------------------------------

select lives_ok(
    $$
        insert into public.workout_sessions (id, user_id, local_date, title)
        values (
            '10000000-0000-4000-8000-0000000000b1',
            '22222222-2222-2222-2222-222222222222',
            '2026-06-16',
            'Own session of B'
        )
    $$,
    'B can insert a workout_session it owns'
);

select throws_ok(
    $$
        update public.workout_sessions
           set user_id = '11111111-1111-1111-1111-111111111111'
         where id = '10000000-0000-4000-8000-0000000000b1'
    $$,
    '42501',
    'B cannot reassign its own session to A'
);

-- ---------------------------------------------------------------------------
-- 26-27. Back as the owner: none of the attempts above changed anything.
-- ---------------------------------------------------------------------------

reset role;

select is(
    (
        select count(*)::int
        from (
            select user_id from public.profiles
            union all select user_id from public.workout_sessions
            union all select user_id from public.activities
            union all select user_id from public.strength_sets
            union all select user_id from public.cardio_intervals
            union all select user_id from public.circuit_results
            union all select user_id from public.circuit_movements
            union all select user_id from public.benchmark_results
            union all select user_id from public.benchmark_splits
            union all select user_id from public.import_batches
            union all select user_id from public.import_entries
        ) as chain
        where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    14,
    'the chain of A is still 14 rows after every attempt by B'
);

select is(
    (select title from public.workout_sessions where id = '10000000-0000-4000-8000-000000000001'),
    'Squats, run, Cindy, Murph',
    'the session title of A is untouched'
);

select * from finish();

rollback;
