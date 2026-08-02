-- 001_ownership_chain_test.sql
--
-- Structural test: a complete ownership chain for one athlete can be written,
-- every child carries the denormalized user_id, and RLS is switched on
-- everywhere with exactly the intended set of policies.
--
-- Every test file in this directory is self-contained: it seeds its own users
-- inside a transaction that is rolled back, so files can run in any order and
-- leave no residue.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Fixed UUIDs so assertions can name rows directly:
--   user A  11111111-...   user B  22222222-...
--   1x sessions  2x activities  3x strength_sets  4x cardio_intervals
--   5x circuit_results  6x circuit_movements  7x benchmark_results
--   8x benchmark_splits  9x tags  bx import_*

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@pgtap.test', '', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@pgtap.test', '', now(), now(), now());

-- Reference data, prefixed so it cannot collide with seed.sql.
insert into public.exercises (id, slug, name, movement_pattern)
values ('e0000000-0000-4000-8000-000000000001', 'pgtap-hex-bar-deadlift', 'pgTAP Hex Bar Deadlift', 'hinge');

insert into public.exercise_aliases (exercise_id, alias, language, is_misspelling)
values ('e0000000-0000-4000-8000-000000000001', 'pgtap deadlifw', 'en', true);

insert into public.benchmark_definitions (id, slug, name, scoring, expected_split_labels)
values (
    'd0000000-0000-4000-8000-000000000001',
    'pgtap-murph',
    'pgTAP Murph',
    'time',
    array['run 1', '100 pull ups', '200 push ups', '300 squats', 'run 2']
);

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
    'Full Murph',
    'excel_import',
    'Full Murph. Run 1 - 8:57. 100 pull ups, 200 push ups, 300 squats. Finished at 39:56.',
    5400,
    9,
    'completed',
    'import:Training programm 2026:24:8:1'
);

insert into public.activities (id, user_id, session_id, sequence, modality, subtype, objective, intensity, duration_seconds, distance_km)
values
    ('20000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 1, 'strength', 'hex_bar', 'max_strength', 'hard', 1800, null),
    ('20000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 2, 'running', 'outdoor', 'aerobic_base', 'moderate', 1200, 3.2),
    ('20000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 3, 'hybrid_conditioning', null, 'hybrid_conditioning', 'hard', 900, null),
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
    'e0000000-0000-4000-8000-000000000001',
    'Deadlifw with Hex bar 5x100kg',
    1,
    'working',
    5,
    100,
    'kg',
    'total',
    100,
    'Deadlifw with Hex bar 5x100kg'
);

-- speed_value with a null speed_unit: the R5C6 `speed = 7.0` case, preserved
-- rather than assumed to be km/h.
insert into public.cardio_intervals (
    id, user_id, activity_id, interval_index, interval_type,
    duration_seconds, distance_km, pace_seconds_per_km, speed_value, speed_unit,
    heart_rate_bpm, original_text
)
values (
    '40000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000002',
    1,
    'work',
    1200,
    3.2,
    409,
    7.0,
    null,
    162,
    '3.2 km, speed = 7.0'
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
    total_seconds, vest_kg, as_prescribed, partition_strategy, original_text
)
values (
    '70000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000001',
    'pgtap-murph',
    'time',
    2396,
    9,
    true,
    'started doing sets of 4 at 30, sets of 3 at 38',
    'Full Murph, finished at 39:56'
);

-- The R24C8 case: elapsed_seconds as written, split_seconds left null because
-- the reference frame shifts mid-cell.
insert into public.benchmark_splits (
    id, user_id, benchmark_result_id, split_order, label, reps,
    elapsed_seconds, split_seconds, is_cumulative, reference_frame, original_text
)
values (
    '80000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '70000000-0000-4000-8000-000000000001',
    3,
    '200 push ups',
    200,
    1755,
    null,
    true,
    'movement_block_start',
    '200 push ups (29:15 after the start of pull ups)'
);

-- updated_at is seeded stale on purpose so the trigger has something to change:
-- created_at and now() are identical inside one transaction.
insert into public.tags (id, user_id, slug, label, updated_at)
values ('90000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'murph', 'Murph', '2000-01-01T00:00:00+00');

insert into public.session_tags (user_id, session_id, tag_id)
values ('11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001');

insert into public.activity_tags (user_id, activity_id, tag_id)
values ('11111111-1111-1111-1111-111111111111', '20000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001');

insert into public.daily_checkins (id, user_id, local_date, sleep_hours, sleep_quality, fatigue, soreness, notes)
values (
    'c0000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '2026-06-15',
    7.5,
    4,
    3,
    '{"quads": 3, "lower_back": 1}'::jsonb,
    'Legs heavy after Murph.'
);

insert into public.body_measurements (id, user_id, local_date, body_weight_kg, waist_cm)
values ('c0000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-06-15', 82.4, 84);

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

insert into public.import_entry_sessions (user_id, import_entry_id, session_id, ordinal)
values (
    '11111111-1111-1111-1111-111111111111',
    'b0000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    1
);

insert into public.ai_runs (
    id, user_id, provider, model, operation, prompt_version, status, latency_ms,
    input_tokens, output_tokens, schema_valid, session_id, import_entry_id
)
values (
    'f0000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'cloudflare_workers_ai',
    '@cf/meta/llama-3.1-8b-instruct',
    'import_draft',
    'import-draft-v1',
    'succeeded',
    812,
    1420,
    260,
    true,
    '10000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000002'
);

insert into public.user_corrections (
    id, user_id, source_kind, original_draft, approved_result, changed_fields, parser_version, session_id
)
values (
    'f0000000-0000-4000-8000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'import_entry',
    '{"totalSeconds": 2396}'::jsonb,
    '{"totalSeconds": 2400}'::jsonb,
    array['benchmark.totalSeconds'],
    'parser-0.1.0',
    '10000000-0000-4000-8000-000000000001'
);

-- ---------------------------------------------------------------------------
-- 1. Profile defaults
-- ---------------------------------------------------------------------------

select is(
    (select timezone from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
    'Europe/Amsterdam',
    'profiles.timezone defaults to Europe/Amsterdam'
);

-- ---------------------------------------------------------------------------
-- 2-9. The chain was written, level by level
-- ---------------------------------------------------------------------------

select is(
    (select count(*)::int from public.workout_sessions where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'user A has one workout_session'
);

select is(
    (select count(*)::int from public.activities where user_id = '11111111-1111-1111-1111-111111111111'),
    4,
    'the session holds four activities'
);

select is(
    (select count(*)::int from public.strength_sets where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the strength activity holds one set'
);

select is(
    (select count(*)::int from public.cardio_intervals where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the running activity holds one cardio interval'
);

select is(
    (select count(*)::int from public.circuit_results where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the conditioning activity holds one circuit result'
);

select is(
    (select count(*)::int from public.circuit_movements where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the circuit holds one movement'
);

select is(
    (select count(*)::int from public.benchmark_results where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the benchmark activity holds one benchmark result'
);

select is(
    (select count(*)::int from public.benchmark_splits where user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'the benchmark result holds one split'
);

-- ---------------------------------------------------------------------------
-- 10. The design statement: every descendant carries user A's user_id.
-- Nothing copies it there — the composite foreign keys make any other value
-- unrepresentable.
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from (
            select user_id from public.activities
            union all select user_id from public.strength_sets
            union all select user_id from public.cardio_intervals
            union all select user_id from public.circuit_results
            union all select user_id from public.circuit_movements
            union all select user_id from public.benchmark_results
            union all select user_id from public.benchmark_splits
            union all select user_id from public.session_tags
            union all select user_id from public.activity_tags
            union all select user_id from public.import_entries
            union all select user_id from public.import_entry_sessions
        ) as chain
        where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    14,
    'all 14 descendant rows carry the denormalized user_id of user A'
);

-- ---------------------------------------------------------------------------
-- 11. client_request_key is both the idempotency key and the source locator
-- ---------------------------------------------------------------------------

select is(
    (select client_request_key from public.workout_sessions where id = '10000000-0000-4000-8000-000000000001'),
    'import:Training programm 2026:24:8:1',
    'the session carries its import:{sheet}:{row}:{col}:{ordinal} locator'
);

-- ---------------------------------------------------------------------------
-- 12. The updated_at trigger fires
-- ---------------------------------------------------------------------------

update public.tags
set label = 'Murph (RX)'
where id = '90000000-0000-4000-8000-000000000001';

select is(
    (select updated_at from public.tags where id = '90000000-0000-4000-8000-000000000001'),
    now(),
    'the set_updated_at trigger stamps updated_at on UPDATE'
);

-- ---------------------------------------------------------------------------
-- 13-14. Ambiguity is preserved, not resolved
-- ---------------------------------------------------------------------------

select ok(
    (
        select speed_value is not null and speed_unit is null
        from public.cardio_intervals
        where id = '40000000-0000-4000-8000-000000000001'
    ),
    'a unitless treadmill speed is stored with speed_unit null, never assumed'
);

select ok(
    (
        select elapsed_seconds is not null and split_seconds is null and is_cumulative
        from public.benchmark_splits
        where id = '80000000-0000-4000-8000-000000000001'
    ),
    'a cumulative Murph split keeps elapsed_seconds and leaves split_seconds null'
);

-- ---------------------------------------------------------------------------
-- 15. RLS is enabled on every table in the schema, reference tables included
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any (array[
              'profiles', 'workout_sessions', 'activities', 'strength_sets',
              'cardio_intervals', 'circuit_results', 'circuit_movements',
              'benchmark_results', 'benchmark_splits', 'daily_checkins',
              'body_measurements', 'tags', 'session_tags', 'activity_tags',
              'import_batches', 'import_entries', 'import_entry_sessions',
              'ai_runs', 'user_corrections',
              'exercises', 'exercise_aliases', 'benchmark_definitions'
          ])
          and not c.relrowsecurity
    ),
    0,
    'row level security is enabled on all 22 tables'
);

-- ---------------------------------------------------------------------------
-- 16. Four policies on every user-owned table: 19 tables x 4 = 76
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = any (array[
              'profiles', 'workout_sessions', 'activities', 'strength_sets',
              'cardio_intervals', 'circuit_results', 'circuit_movements',
              'benchmark_results', 'benchmark_splits', 'daily_checkins',
              'body_measurements', 'tags', 'session_tags', 'activity_tags',
              'import_batches', 'import_entries', 'import_entry_sessions',
              'ai_runs', 'user_corrections'
          ])
    ),
    76,
    'each of the 19 user-owned tables has exactly four policies'
);

-- ---------------------------------------------------------------------------
-- 17-18. Global reference data is readable by all and writable by none
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = any (array['exercises', 'exercise_aliases', 'benchmark_definitions'])
          and cmd = 'SELECT'
    ),
    3,
    'each reference table has one select policy'
);

select is(
    (
        select count(*)::int
        from pg_policies
        where schemaname = 'public'
          and tablename = any (array['exercises', 'exercise_aliases', 'benchmark_definitions'])
          and cmd <> 'SELECT'
    ),
    0,
    'no reference table has an insert, update or delete policy'
);

select * from finish();

rollback;
