-- 0005_strength_cardio_circuits.sql
--
-- The three leaf shapes an activity can take: sets, intervals, circuits.
-- All three hang off `activities` through the composite `(activity_id, user_id)`
-- foreign key established in 0004, so ownership cannot drift and every RLS
-- policy stays the plain `user_id = auth.uid()`.
--
-- Exercise references follow the pattern from packages/domain/src/exercise.ts:
-- `exercise_raw_text` is kept verbatim ALWAYS, `exercise_id` is the resolved
-- canonical row and is NULLABLE. An unresolved alias must be storable — losing
-- the row because the library is incomplete would be the worse failure.

-- ---------------------------------------------------------------------------
-- strength_sets
-- ---------------------------------------------------------------------------

create table if not exists public.strength_sets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    activity_id uuid not null,

    -- 1-based position within the activity, across all exercises, in source order.
    set_index smallint not null,

    -- Resolved canonical exercise, or null when no alias matched.
    exercise_id uuid references public.exercises (id) on delete set null,
    -- Verbatim source text. Always retained so a bad alias can be re-derived.
    exercise_raw_text text not null,
    -- `climbers bar`, `hex bar`, `rogue` — context, never a separate exercise.
    apparatus text,
    -- 0..1. Exact alias hits are 1; normalized/fuzzy hits score lower.
    exercise_confidence numeric not null default 0,

    set_type public.strength_set_type not null default 'working',
    reps smallint,

    -- The source's own claim about the load.
    load_value numeric,
    load_unit public.load_unit not null default 'none',
    load_scope public.load_scope not null default 'unknown',
    -- The derived canonical figure. Null whenever conversion would be a guess.
    load_kg numeric,

    side public.body_side,
    rir smallint,
    rpe numeric,
    tempo text,
    rest_seconds integer,
    -- Hold duration for isometrics (`Plank: 4x1 min`, `1 minute dead hang`).
    hold_seconds numeric,
    completed boolean not null default true,
    notes text,
    -- The exact source substring this set came from.
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint strength_sets_id_user_id_key unique (id, user_id),
    constraint strength_sets_activity_id_set_index_key unique (activity_id, set_index),

    constraint strength_sets_activity_id_user_id_fkey
        foreign key (activity_id, user_id)
        references public.activities (id, user_id)
        on delete cascade,

    -- ----------------------------------------------------------------------
    -- The project's core data-integrity rule, mirroring the superRefine in
    -- packages/domain/src/strength.ts. A lat-pulldown `value = 6` is a pin
    -- position, and a bare `4x165` states no unit; neither can become a
    -- kilogram figure. Enforced in the database as well as in Zod because a
    -- fabricated load silently corrupts training history forever.
    -- ----------------------------------------------------------------------
    constraint strength_sets_machine_setting_not_kg_check
        check (load_scope <> 'machine_setting' or load_kg is null),
    constraint strength_sets_no_unit_not_kg_check
        check (load_unit <> 'none' or load_kg is null),

    constraint strength_sets_set_index_check check (set_index > 0),
    constraint strength_sets_exercise_raw_text_check
        check (length(btrim(exercise_raw_text)) > 0),
    constraint strength_sets_exercise_confidence_check
        check (exercise_confidence between 0 and 1),
    constraint strength_sets_reps_check check (reps is null or reps >= 0),
    constraint strength_sets_rpe_check check (rpe is null or rpe between 0 and 10)
);

comment on table public.strength_sets is
    'One performed set. Composite FK to activities (id, user_id).';

comment on column public.strength_sets.load_kg is
    'Derived canonical kilograms. Null for machine settings and unitless loads.';

create index if not exists strength_sets_user_id_idx
    on public.strength_sets (user_id);

create index if not exists strength_sets_activity_id_user_id_idx
    on public.strength_sets (activity_id, user_id);

create index if not exists strength_sets_user_id_exercise_id_idx
    on public.strength_sets (user_id, exercise_id);

create index if not exists strength_sets_user_id_set_type_idx
    on public.strength_sets (user_id, set_type);

create or replace trigger strength_sets_set_updated_at
    before update on public.strength_sets
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cardio_intervals
-- ---------------------------------------------------------------------------

create table if not exists public.cardio_intervals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    activity_id uuid not null,

    interval_index smallint not null,
    interval_type public.cardio_interval_type not null default 'work',

    duration_seconds numeric,
    rest_seconds numeric,
    distance_km numeric,
    -- Seconds per kilometre. `6:49 per km` -> 409.
    pace_seconds_per_km numeric,
    -- Rowing/ski convention: seconds per 500 m. `2:14.9/500m` -> 134.9.
    split_seconds_per_500m numeric,

    speed_value numeric,
    -- Null when the source stated a bare number (`speed = 7.0`, R5C6). Never
    -- assumed to be km/h; an AMBIGUOUS_SPEED_UNIT warning is emitted instead.
    speed_unit text,

    heart_rate_bpm smallint,
    power_watts numeric,
    cadence_spm numeric,
    calories numeric,
    notes text,
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint cardio_intervals_id_user_id_key unique (id, user_id),
    constraint cardio_intervals_activity_id_interval_index_key
        unique (activity_id, interval_index),

    constraint cardio_intervals_activity_id_user_id_fkey
        foreign key (activity_id, user_id)
        references public.activities (id, user_id)
        on delete cascade,

    constraint cardio_intervals_interval_index_check check (interval_index > 0),
    -- Mirrors CardioIntervalDraftSchema.speedUnit: z.enum(['kmh','mph']).nullable().
    constraint cardio_intervals_speed_unit_check
        check (speed_unit is null or speed_unit in ('kmh', 'mph')),
    constraint cardio_intervals_duration_seconds_check
        check (duration_seconds is null or duration_seconds >= 0),
    constraint cardio_intervals_distance_km_check
        check (distance_km is null or distance_km >= 0)
);

comment on table public.cardio_intervals is
    'One interval or split. Supports Norwegian 4x4, rowing splits, run repeats.';

comment on column public.cardio_intervals.speed_unit is
    'kmh | mph, or null when the source stated a bare number. Never assumed.';

create index if not exists cardio_intervals_user_id_idx
    on public.cardio_intervals (user_id);

create index if not exists cardio_intervals_activity_id_user_id_idx
    on public.cardio_intervals (activity_id, user_id);

create index if not exists cardio_intervals_user_id_interval_type_idx
    on public.cardio_intervals (user_id, interval_type);

create or replace trigger cardio_intervals_set_updated_at
    before update on public.cardio_intervals
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- circuit_results
-- ---------------------------------------------------------------------------

create table if not exists public.circuit_results (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    activity_id uuid not null,

    format public.circuit_format not null default 'rounds',
    name text,

    -- What the source said to do vs. what was actually done. Kept apart so a
    -- cut-short workout stays honest.
    rounds_prescribed smallint,
    rounds_completed numeric,
    partial_round_reps smallint,

    time_cap_seconds numeric,
    completion_seconds numeric,
    -- Free-form score for formats where time and rounds do not apply.
    score text,
    -- `work` / `rest` seconds for interval circuits.
    work_seconds numeric,
    rest_seconds numeric,
    -- Null means the source did not say whether it was as prescribed.
    as_prescribed boolean,

    details jsonb not null default '{}'::jsonb,
    notes text,
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint circuit_results_id_user_id_key unique (id, user_id),
    -- One circuit per activity: a second circuit is a second activity.
    constraint circuit_results_activity_id_key unique (activity_id),

    constraint circuit_results_activity_id_user_id_fkey
        foreign key (activity_id, user_id)
        references public.activities (id, user_id)
        on delete cascade,

    constraint circuit_results_details_object_check
        check (jsonb_typeof(details) = 'object'),
    constraint circuit_results_rounds_prescribed_check
        check (rounds_prescribed is null or rounds_prescribed > 0),
    constraint circuit_results_rounds_completed_check
        check (rounds_completed is null or rounds_completed >= 0)
);

comment on table public.circuit_results is
    'AMRAP/EMOM/for-time/rounds scoring for one activity. Composite FK to activities.';

create index if not exists circuit_results_user_id_idx
    on public.circuit_results (user_id);

create index if not exists circuit_results_activity_id_user_id_idx
    on public.circuit_results (activity_id, user_id);

create index if not exists circuit_results_user_id_format_idx
    on public.circuit_results (user_id, format);

create or replace trigger circuit_results_set_updated_at
    before update on public.circuit_results
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- circuit_movements
-- ---------------------------------------------------------------------------

create table if not exists public.circuit_movements (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    circuit_result_id uuid not null,

    movement_order smallint not null,

    exercise_id uuid references public.exercises (id) on delete set null,
    exercise_raw_text text not null,
    apparatus text,
    exercise_confidence numeric not null default 0,

    target_reps smallint,
    target_calories numeric,
    target_distance_km numeric,
    target_seconds numeric,

    load_value numeric,
    load_unit public.load_unit not null default 'none',
    load_scope public.load_scope not null default 'unknown',
    load_kg numeric,

    notes text,
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint circuit_movements_id_user_id_key unique (id, user_id),
    constraint circuit_movements_circuit_result_id_movement_order_key
        unique (circuit_result_id, movement_order),

    constraint circuit_movements_circuit_result_id_user_id_fkey
        foreign key (circuit_result_id, user_id)
        references public.circuit_results (id, user_id)
        on delete cascade,

    -- Same load-integrity rule as strength_sets: a machine setting or a
    -- unitless number never becomes kilograms.
    constraint circuit_movements_machine_setting_not_kg_check
        check (load_scope <> 'machine_setting' or load_kg is null),
    constraint circuit_movements_no_unit_not_kg_check
        check (load_unit <> 'none' or load_kg is null),

    constraint circuit_movements_movement_order_check check (movement_order > 0),
    constraint circuit_movements_exercise_raw_text_check
        check (length(btrim(exercise_raw_text)) > 0),
    constraint circuit_movements_exercise_confidence_check
        check (exercise_confidence between 0 and 1)
);

comment on table public.circuit_movements is
    'Ordered movements inside a circuit. Composite FK to circuit_results (id, user_id).';

create index if not exists circuit_movements_user_id_idx
    on public.circuit_movements (user_id);

create index if not exists circuit_movements_circuit_result_id_user_id_idx
    on public.circuit_movements (circuit_result_id, user_id);

create index if not exists circuit_movements_user_id_exercise_id_idx
    on public.circuit_movements (user_id, exercise_id);

create or replace trigger circuit_movements_set_updated_at
    before update on public.circuit_movements
    for each row
    execute function public.set_updated_at();
