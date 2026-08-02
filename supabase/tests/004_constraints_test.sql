-- 004_constraints_test.sql
--
-- The rules the database enforces on its own, independent of RLS and of the Zod
-- layer: load integrity, identity, and cascade depth.
--
-- 1. LOAD INTEGRITY. A lat-pulldown `value = 6` is a pin position and a bare
--    `4x165` states no unit; neither can become a kilogram figure. The two CHECK
--    constraints in 0005 mirror the superRefine in packages/domain/src/strength.ts,
--    because a fabricated load silently corrupts training history forever.
--
-- 2. IDENTITY. `workout_sessions (user_id, client_request_key)` makes a rerun of
--    the importer an upsert instead of a duplicate day, and
--    `import_entries (user_id, sheet_name, source_row, source_col)` keeps exactly
--    one staging row per source cell, forever. Both are scoped per user, which is
--    also asserted: the same key for a different athlete is legal.
--
-- 3. CASCADE DEPTH. Deleting a session must take its whole subtree with it, four
--    levels down, while the import provenance that produced it survives.
--
-- Runs as the migration owner with RLS bypassed: these are constraints, not
-- policies.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@pgtap.test', '', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@pgtap.test', '', now(), now(), now());

insert into public.exercises (id, slug, name, movement_pattern)
values ('e0000000-0000-4000-8000-000000000004', 'pgtap-004-lat-pulldown', 'pgTAP Lat Pulldown', 'vertical_pull');

insert into public.profiles (user_id, display_name)
values ('11111111-1111-1111-1111-111111111111', 'Athlete A');

insert into public.workout_sessions (id, user_id, local_date, title, source, client_request_key)
values (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '2026-06-15',
    'Session of A',
    'excel_import',
    'import:Training programm 2026:24:8:1'
);

insert into public.activities (id, user_id, session_id, sequence, modality, objective, intensity)
values
    ('20000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 1, 'strength', 'max_strength', 'hard'),
    ('20000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 2, 'running', 'aerobic_base', 'moderate'),
    ('20000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 3, 'hybrid_conditioning', 'hybrid_conditioning', 'hard'),
    ('20000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 4, 'hybrid_conditioning', 'race_specific', 'max');

insert into public.strength_sets (
    id, user_id, activity_id, set_index, exercise_raw_text, set_type, reps,
    load_value, load_unit, load_scope, load_kg
)
values (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000001',
    1,
    'Back squat 5x100kg',
    'working',
    5,
    100,
    'kg',
    'total',
    100
);

insert into public.cardio_intervals (id, user_id, activity_id, interval_index, interval_type, distance_km)
values (
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000002',
    1,
    'work',
    3.2
);

insert into public.circuit_results (id, user_id, activity_id, format, name, rounds_completed)
values (
    '50000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000003',
    'rounds',
    'Cindy',
    12
);

insert into public.circuit_movements (id, user_id, circuit_result_id, movement_order, exercise_raw_text, target_reps)
values (
    '60000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '50000000-0000-4000-8000-000000000001',
    1,
    '5 pull ups',
    5
);

insert into public.benchmark_results (id, user_id, activity_id, definition_slug, scoring, total_seconds)
values (
    '70000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000004',
    'pgtap-004-murph',
    'time',
    2396
);

insert into public.benchmark_splits (id, user_id, benchmark_result_id, split_order, label, elapsed_seconds)
values (
    '80000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '70000000-0000-4000-8000-000000000001',
    1,
    'run 1',
    537
);

insert into public.import_batches (id, user_id, file_name, sheet_name, importer_version, parser_version)
values
    ('b0000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Training programm 2026.xlsx', 'Training programm 2026', 'importer-0.1.0', 'parser-0.1.0'),
    ('b0000000-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Training programm 2026.xlsx', 'Training programm 2026', 'importer-0.1.0', 'parser-0.1.0');

insert into public.import_entries (
    id, user_id, batch_id, sheet_name, source_row, source_col, cell_ref, raw_text, raw_text_sha256, review_status
)
values (
    'b0000000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'b0000000-0000-4000-8000-000000000001',
    'Training programm 2026',
    24,
    8,
    'R24C8',
    'Full Murph, finished at 39:56',
    repeat('ab', 32),
    'applied'
);

insert into public.import_entry_sessions (user_id, import_entry_id, session_id, ordinal)
values (
    '11111111-1111-1111-1111-111111111111',
    'b0000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    1
);

-- ---------------------------------------------------------------------------
-- 1. The subtree exists before anything is deleted, so the zeros asserted at
-- the end of this file mean "cascaded away" and not "never written".
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from (
            select 1 from public.activities where session_id = '10000000-0000-4000-8000-000000000001'
            union all select 1 from public.strength_sets where activity_id = '20000000-0000-4000-8000-000000000001'
            union all select 1 from public.cardio_intervals where activity_id = '20000000-0000-4000-8000-000000000002'
            union all select 1 from public.circuit_results where activity_id = '20000000-0000-4000-8000-000000000003'
            union all select 1 from public.circuit_movements where circuit_result_id = '50000000-0000-4000-8000-000000000001'
            union all select 1 from public.benchmark_results where activity_id = '20000000-0000-4000-8000-000000000004'
            union all select 1 from public.benchmark_splits where benchmark_result_id = '70000000-0000-4000-8000-000000000001'
            union all select 1 from public.import_entry_sessions where session_id = '10000000-0000-4000-8000-000000000001'
        ) as subtree
    ),
    11,
    'the session of A has an 11-row subtree before the cascade'
);

-- ---------------------------------------------------------------------------
-- 2-6. Load integrity. A machine setting and a unitless number are recorded as
-- what the source said; neither may carry a derived load_kg.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        insert into public.strength_sets (
            user_id, activity_id, set_index, exercise_raw_text, reps,
            load_value, load_unit, load_scope, load_kg
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            '20000000-0000-4000-8000-000000000001',
            4,
            'Lat pulldown 4x6',
            6,
            6, 'kg', 'machine_setting', 60
        )
    $$,
    '23514',
    'strength_sets rejects load_kg when load_scope is machine_setting'
);

select throws_ok(
    $$
        insert into public.strength_sets (
            user_id, activity_id, set_index, exercise_raw_text, reps,
            load_value, load_unit, load_scope, load_kg
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            '20000000-0000-4000-8000-000000000001',
            5,
            'Bench press 4x165',
            4,
            165, 'none', 'total', 165
        )
    $$,
    '23514',
    'strength_sets rejects load_kg when load_unit is none'
);

select lives_ok(
    $$
        insert into public.strength_sets (
            user_id, activity_id, set_index, exercise_id, exercise_raw_text, reps,
            load_value, load_unit, load_scope, load_kg
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            '20000000-0000-4000-8000-000000000001',
            2,
            'e0000000-0000-4000-8000-000000000004',
            'Lat pulldown 4x6',
            6,
            6, 'none', 'machine_setting', null
        )
    $$,
    'a machine setting is storable as written, with load_kg left null'
);

select lives_ok(
    $$
        insert into public.strength_sets (
            user_id, activity_id, set_index, exercise_raw_text, reps,
            load_value, load_unit, load_scope, load_kg
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            '20000000-0000-4000-8000-000000000001',
            3,
            'Back squat 5x100kg',
            5,
            100, 'kg', 'total', 100
        )
    $$,
    'a stated kilogram load is storable with the derived load_kg'
);

select throws_ok(
    $$
        insert into public.circuit_movements (
            user_id, circuit_result_id, movement_order, exercise_raw_text,
            load_value, load_unit, load_scope, load_kg
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            '50000000-0000-4000-8000-000000000001',
            2,
            'Lat pulldown',
            6, 'kg', 'machine_setting', 60
        )
    $$,
    '23514',
    'circuit_movements applies the same load rule as strength_sets'
);

-- ---------------------------------------------------------------------------
-- 7-10. Identity. Both keys are unique PER USER: a rerun cannot duplicate a
-- day or a cell, and two athletes importing the same workbook do not collide.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        insert into public.workout_sessions (user_id, local_date, title, client_request_key)
        values (
            '11111111-1111-1111-1111-111111111111',
            '2026-06-15',
            'Rerun of the same cell',
            'import:Training programm 2026:24:8:1'
        )
    $$,
    '23505',
    'workout_sessions rejects a duplicate (user_id, client_request_key)'
);

select lives_ok(
    $$
        insert into public.workout_sessions (id, user_id, local_date, title, client_request_key)
        values (
            '10000000-0000-4000-8000-0000000000b1',
            '22222222-2222-2222-2222-222222222222',
            '2026-06-15',
            'Same locator, other athlete',
            'import:Training programm 2026:24:8:1'
        )
    $$,
    'the same client_request_key is accepted for a different user'
);

select throws_ok(
    $$
        insert into public.import_entries (
            user_id, batch_id, sheet_name, source_row, source_col, cell_ref, raw_text, raw_text_sha256
        )
        values (
            '11111111-1111-1111-1111-111111111111',
            'b0000000-0000-4000-8000-000000000001',
            'Training programm 2026',
            24,
            8,
            'R24C8',
            'Full Murph, finished at 39:56',
            repeat('ab', 32)
        )
    $$,
    '23505',
    'import_entries rejects a second staging row for the same source cell'
);

select lives_ok(
    $$
        insert into public.import_entries (
            user_id, batch_id, sheet_name, source_row, source_col, cell_ref, raw_text, raw_text_sha256
        )
        values (
            '22222222-2222-2222-2222-222222222222',
            'b0000000-0000-4000-8000-0000000000b1',
            'Training programm 2026',
            24,
            8,
            'R24C8',
            'Full Murph, finished at 39:56',
            repeat('ab', 32)
        )
    $$,
    'the same source cell is accepted for a different user'
);

-- ---------------------------------------------------------------------------
-- 11-20. Cascade. One delete at the top of the chain.
-- ---------------------------------------------------------------------------

delete from public.workout_sessions
 where id = '10000000-0000-4000-8000-000000000001';

select is(
    (select count(*)::int from public.workout_sessions where user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'the session of A is gone'
);

select is(
    (select count(*)::int from public.activities where session_id = '10000000-0000-4000-8000-000000000001'),
    0,
    'deleting the session cascaded to its activities'
);

select is(
    (select count(*)::int from public.strength_sets where activity_id = '20000000-0000-4000-8000-000000000001'),
    0,
    'the cascade reached the strength_sets of the strength activity'
);

select is(
    (select count(*)::int from public.cardio_intervals where activity_id = '20000000-0000-4000-8000-000000000002'),
    0,
    'the cascade reached the cardio_intervals of the running activity'
);

select is(
    (select count(*)::int from public.circuit_results where activity_id = '20000000-0000-4000-8000-000000000003'),
    0,
    'the cascade reached the circuit_result'
);

select is(
    (select count(*)::int from public.circuit_movements where circuit_result_id = '50000000-0000-4000-8000-000000000001'),
    0,
    'the cascade reached the circuit_movements two levels below the session'
);

select is(
    (select count(*)::int from public.benchmark_results where activity_id = '20000000-0000-4000-8000-000000000004'),
    0,
    'the cascade reached the benchmark_result'
);

select is(
    (select count(*)::int from public.benchmark_splits where benchmark_result_id = '70000000-0000-4000-8000-000000000001'),
    0,
    'the cascade reached the benchmark_splits three levels below the session'
);

select is(
    (select count(*)::int from public.import_entry_sessions where session_id = '10000000-0000-4000-8000-000000000001'),
    0,
    'the provenance link to the deleted session is gone'
);

-- The staging row itself is NOT provenance of a session; it is the record of a
-- source cell, and it outlives whatever was built from it.
select is(
    (select count(*)::int from public.import_entries where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the import_entry survives the deletion of the session it produced'
);

select * from finish();

rollback;
