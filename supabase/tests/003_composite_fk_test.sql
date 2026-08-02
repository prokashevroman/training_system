-- 003_composite_fk_test.sql
--
-- THE LOAD-BEARING TEST OF THE SCHEMA.
--
-- Every child in 0004-0009 reaches its parent through a COMPOSITE foreign key
-- `(parent_id, user_id)` against the parent's `unique (id, user_id)`. The claim
-- that follows from it is strong: a child whose user_id disagrees with its
-- parent's is not merely discouraged, it is UNREPRESENTABLE. Postgres refuses
-- the row with 23503 foreign_key_violation.
--
-- That is what makes the flat `user_id = auth.uid()` policy in 0010 equivalent
-- to walking the parent chain — and it is why 002 can trust the denormalized
-- user_id on a leaf row.
--
-- Everything here runs as the migration owner, with RLS bypassed, on purpose:
-- the refusals below are structural, not policy-based. Remove every policy in
-- 0010 and this file still passes.
--
-- Ownership drift is attempted from three directions: on insert (a new child
-- pointed at someone else's parent), after the fact (an existing child rewritten
-- to another user), and from above (a parent rewritten out from under its
-- children).

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures: one parent of every kind, all owned by A. B owns nothing.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@pgtap.test', '', now(), now(), now()),
    ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@pgtap.test', '', now(), now(), now());

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

-- Four activities so each single-child-per-activity parent (circuit_results,
-- benchmark_results, both unique on activity_id) has a free slot to be refused
-- in: a unique violation would mask the foreign key violation being asserted.
insert into public.activities (id, user_id, session_id, sequence, modality, objective, intensity)
values
    ('20000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 1, 'strength', 'max_strength', 'hard'),
    ('20000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 2, 'running', 'aerobic_base', 'moderate'),
    ('20000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 3, 'hybrid_conditioning', 'hybrid_conditioning', 'hard'),
    ('20000000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111', '10000000-0000-4000-8000-000000000001', 4, 'hybrid_conditioning', 'race_specific', 'max');

insert into public.strength_sets (id, user_id, activity_id, set_index, exercise_raw_text, set_type, reps)
values (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000001',
    1,
    'Back squat 5x100kg',
    'working',
    5
);

insert into public.circuit_results (id, user_id, activity_id, format, name)
values (
    '50000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000003',
    'rounds',
    'Cindy'
);

insert into public.benchmark_results (id, user_id, activity_id, definition_slug, scoring, total_seconds)
values (
    '70000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '20000000-0000-4000-8000-000000000004',
    'pgtap-003-murph',
    'time',
    2396
);

insert into public.tags (id, user_id, slug, label)
values ('90000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'murph', 'Murph');

insert into public.import_batches (id, user_id, file_name, sheet_name, importer_version, parser_version)
values (
    'b0000000-0000-4000-8000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'Training programm 2026.xlsx',
    'Training programm 2026',
    'importer-0.1.0',
    'parser-0.1.0'
);

insert into public.import_entries (
    id, user_id, batch_id, sheet_name, source_row, source_col, cell_ref, raw_text, raw_text_sha256
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
    repeat('ab', 32)
);

-- ---------------------------------------------------------------------------
-- 1. Control: the same insert with the MATCHING user_id is accepted. Without
-- this, every assertion below could be passing for the wrong reason.
-- ---------------------------------------------------------------------------

select lives_ok(
    $$
        insert into public.activities (id, user_id, session_id, sequence, modality)
        values (
            '20000000-0000-4000-8000-000000000009',
            '11111111-1111-1111-1111-111111111111',
            '10000000-0000-4000-8000-000000000001',
            9,
            'mobility_recovery'
        )
    $$,
    'a child whose user_id matches its parent is accepted'
);

-- ---------------------------------------------------------------------------
-- 2-12. Drift on INSERT, refused on every parent/child pair in the schema.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        insert into public.activities (user_id, session_id, sequence, modality)
        values (
            '22222222-2222-2222-2222-222222222222',
            '10000000-0000-4000-8000-000000000001',
            10,
            'strength'
        )
    $$,
    '23503',
    NULL,
    'activities rejects a user_id that disagrees with its workout_session'
);

select throws_ok(
    $$
        insert into public.strength_sets (user_id, activity_id, set_index, exercise_raw_text)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000001',
            9,
            'Back squat 5x100kg'
        )
    $$,
    '23503',
    NULL,
    'strength_sets rejects a user_id that disagrees with its activity'
);

select throws_ok(
    $$
        insert into public.cardio_intervals (user_id, activity_id, interval_index, interval_type)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000002',
            9,
            'work'
        )
    $$,
    '23503',
    NULL,
    'cardio_intervals rejects a user_id that disagrees with its activity'
);

select throws_ok(
    $$
        insert into public.circuit_results (user_id, activity_id, format)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000002',
            'amrap'
        )
    $$,
    '23503',
    NULL,
    'circuit_results rejects a user_id that disagrees with its activity'
);

select throws_ok(
    $$
        insert into public.circuit_movements (user_id, circuit_result_id, movement_order, exercise_raw_text)
        values (
            '22222222-2222-2222-2222-222222222222',
            '50000000-0000-4000-8000-000000000001',
            9,
            '5 pull ups'
        )
    $$,
    '23503',
    NULL,
    'circuit_movements rejects a user_id that disagrees with its circuit_result'
);

select throws_ok(
    $$
        insert into public.benchmark_results (user_id, activity_id, definition_slug, scoring)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000003',
            'pgtap-003-cindy',
            'rounds_reps'
        )
    $$,
    '23503',
    NULL,
    'benchmark_results rejects a user_id that disagrees with its activity'
);

select throws_ok(
    $$
        insert into public.benchmark_splits (user_id, benchmark_result_id, split_order, label)
        values (
            '22222222-2222-2222-2222-222222222222',
            '70000000-0000-4000-8000-000000000001',
            9,
            'run 1'
        )
    $$,
    '23503',
    NULL,
    'benchmark_splits rejects a user_id that disagrees with its benchmark_result'
);

select throws_ok(
    $$
        insert into public.import_entries (
            user_id, batch_id, sheet_name, source_row, source_col, cell_ref, raw_text, raw_text_sha256
        )
        values (
            '22222222-2222-2222-2222-222222222222',
            'b0000000-0000-4000-8000-000000000001',
            'Training programm 2026',
            25,
            8,
            'R25C8',
            'planted',
            repeat('ab', 32)
        )
    $$,
    '23503',
    NULL,
    'import_entries rejects a user_id that disagrees with its import_batch'
);

-- The join tables carry a composite foreign key on BOTH legs, so a tag can
-- never be attached across an ownership boundary in either direction.
select throws_ok(
    $$
        insert into public.session_tags (user_id, session_id, tag_id)
        values (
            '22222222-2222-2222-2222-222222222222',
            '10000000-0000-4000-8000-000000000001',
            '90000000-0000-4000-8000-000000000001'
        )
    $$,
    '23503',
    NULL,
    'session_tags rejects a user_id that disagrees with its session and tag'
);

select throws_ok(
    $$
        insert into public.activity_tags (user_id, activity_id, tag_id)
        values (
            '22222222-2222-2222-2222-222222222222',
            '20000000-0000-4000-8000-000000000001',
            '90000000-0000-4000-8000-000000000001'
        )
    $$,
    '23503',
    NULL,
    'activity_tags rejects a user_id that disagrees with its activity and tag'
);

select throws_ok(
    $$
        insert into public.import_entry_sessions (user_id, import_entry_id, session_id)
        values (
            '22222222-2222-2222-2222-222222222222',
            'b0000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000001'
        )
    $$,
    '23503',
    NULL,
    'import_entry_sessions rejects a user_id that disagrees with its entry and session'
);

-- ---------------------------------------------------------------------------
-- 13-14. Drift AFTER THE FACT: an already-legal child cannot be rewritten to
-- another owner. The row is refused on UPDATE for the same reason.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        update public.activities
           set user_id = '22222222-2222-2222-2222-222222222222'
         where id = '20000000-0000-4000-8000-000000000001'
    $$,
    '23503',
    NULL,
    'an existing activity cannot be rewritten to another owner'
);

select throws_ok(
    $$
        update public.strength_sets
           set user_id = '22222222-2222-2222-2222-222222222222'
         where id = '30000000-0000-4000-8000-000000000001'
    $$,
    '23503',
    NULL,
    'an existing strength_set cannot be rewritten to another owner'
);

-- ---------------------------------------------------------------------------
-- 15. Drift FROM ABOVE: nor can the parent be moved out from under its
-- children, which would orphan them into someone else's ownership.
-- ---------------------------------------------------------------------------

select throws_ok(
    $$
        update public.workout_sessions
           set user_id = '22222222-2222-2222-2222-222222222222'
         where id = '10000000-0000-4000-8000-000000000001'
    $$,
    '23503',
    NULL,
    'a workout_session cannot be reassigned while it still has activities'
);

-- ---------------------------------------------------------------------------
-- 16-17. The pattern is applied everywhere, not just where it was tested:
-- 14 composite (parent_id, user_id) foreign keys against 15 parent-side
-- unique (id, user_id) constraints.
-- ---------------------------------------------------------------------------

select is(
    (
        select count(*)::int
        from pg_constraint c
        where c.connamespace = 'public'::regnamespace
          and c.contype = 'f'
          and array_length(c.conkey, 1) = 2
          and exists (
              select 1
              from unnest(c.conkey) as k
              join pg_attribute a
                on a.attrelid = c.conrelid
               and a.attnum = k
              where a.attname = 'user_id'
          )
    ),
    14,
    'the schema has 14 composite foreign keys carrying user_id'
);

select is(
    (
        select count(*)::int
        from pg_constraint c
        where c.connamespace = 'public'::regnamespace
          and c.contype = 'u'
          and array_length(c.conkey, 1) = 2
          and (
              select array_agg(a.attname::text order by a.attname::text)
              from unnest(c.conkey) as k
              join pg_attribute a
                on a.attrelid = c.conrelid
               and a.attnum = k
          ) = array['id', 'user_id']::text[]
    ),
    15,
    'every user-owned table offers a unique (id, user_id) for children to reference'
);

select * from finish();

rollback;
