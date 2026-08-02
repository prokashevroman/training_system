-- 0006_benchmarks.sql
--
-- Benchmarks are first-class rather than a tag on a session, because the whole
-- point of Murph, Cindy, a 1 km row or a half marathon is comparability across
-- attempts. That requires a shared definition and structured splits.
--
-- `benchmark_definitions` is GLOBAL reference data (no user_id, read-only to
-- users, seeded by migration/seed). `benchmark_results` and `benchmark_splits`
-- are user-owned and follow the composite-FK ownership pattern.

-- ---------------------------------------------------------------------------
-- benchmark_definitions
-- ---------------------------------------------------------------------------

create table if not exists public.benchmark_definitions (
    id uuid primary key default gen_random_uuid(),
    slug text not null,
    name text not null,
    -- How a result is compared: time, rounds_reps, distance, load, custom.
    scoring public.benchmark_scoring not null,
    modality public.activity_modality not null default 'hybrid_conditioning',
    description text,
    -- Prescribed movements/distances, e.g. Murph's 1 mile / 100 / 200 / 300 /
    -- 1 mile. Reference structure only; performed work lives in the results.
    prescription jsonb not null default '{}'::jsonb,
    -- Split labels a result of this benchmark is expected to record, in order:
    -- ['run 1','100 pull ups','200 push ups','300 squats','run 2'].
    expected_split_labels text[] not null default '{}',
    -- False for user-defined tests added later via the service role.
    is_standard boolean not null default true,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint benchmark_definitions_slug_key unique (slug),
    constraint benchmark_definitions_slug_format_check check (slug ~ '^[a-z0-9-]+$'),
    constraint benchmark_definitions_name_check check (length(btrim(name)) > 0),
    constraint benchmark_definitions_prescription_object_check
        check (jsonb_typeof(prescription) = 'object')
);

comment on table public.benchmark_definitions is
    'Global benchmark catalogue (murph, half-murph, cindy, 1000m-row, 5k...). No user_id.';

create index if not exists benchmark_definitions_scoring_idx
    on public.benchmark_definitions (scoring);

create index if not exists benchmark_definitions_is_active_idx
    on public.benchmark_definitions (is_active);

create or replace trigger benchmark_definitions_set_updated_at
    before update on public.benchmark_definitions
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- benchmark_results
-- ---------------------------------------------------------------------------

create table if not exists public.benchmark_results (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    activity_id uuid not null,

    -- Nullable for the same reason exercise_id is: an unrecognised benchmark
    -- name must not cost us the row. definition_slug keeps the source's claim.
    definition_id uuid references public.benchmark_definitions (id) on delete set null,
    definition_slug text not null,
    -- `60% murph`, `75% murph` — a partial attempt of a standard benchmark.
    variant_label text,

    scoring public.benchmark_scoring not null default 'time',
    total_seconds numeric,
    rounds_completed numeric,
    score text,
    vest_kg numeric,
    as_prescribed boolean,
    -- `started doing sets of 4 at 30, sets of 3 at 38` — kept verbatim.
    partition_strategy text,
    notes text,
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint benchmark_results_id_user_id_key unique (id, user_id),
    -- One benchmark result per activity.
    constraint benchmark_results_activity_id_key unique (activity_id),

    constraint benchmark_results_activity_id_user_id_fkey
        foreign key (activity_id, user_id)
        references public.activities (id, user_id)
        on delete cascade,

    constraint benchmark_results_definition_slug_check
        check (length(btrim(definition_slug)) > 0),
    constraint benchmark_results_total_seconds_check
        check (total_seconds is null or total_seconds > 0),
    constraint benchmark_results_vest_kg_check
        check (vest_kg is null or vest_kg >= 0)
);

comment on table public.benchmark_results is
    'One benchmark attempt. Composite FK to activities (id, user_id).';

create index if not exists benchmark_results_user_id_idx
    on public.benchmark_results (user_id);

create index if not exists benchmark_results_activity_id_user_id_idx
    on public.benchmark_results (activity_id, user_id);

-- The comparability query: all of this user's attempts at one benchmark.
create index if not exists benchmark_results_user_id_definition_id_idx
    on public.benchmark_results (user_id, definition_id);

create index if not exists benchmark_results_user_id_definition_slug_idx
    on public.benchmark_results (user_id, definition_slug);

create or replace trigger benchmark_results_set_updated_at
    before update on public.benchmark_results
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- benchmark_splits
-- ---------------------------------------------------------------------------
--
-- The Full Murph cell (R24C8) records CUMULATIVE elapsed times whose reference
-- point shifts mid-cell: `run 1 - 8:57` is a duration, `200 push ups (29:15
-- after the start of pull ups)` is measured from the start of the pull-ups, and
-- `finished at 39:56` is measured from somewhere else again.
--
-- So `elapsed_seconds` holds the figure exactly as written, `reference_frame`
-- records what it was measured from, and `split_seconds` — this segment alone —
-- stays NULL unless the subtraction is unambiguous. Silently subtracting across
-- mixed reference frames produces plausible numbers that are wrong.

create table if not exists public.benchmark_splits (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    benchmark_result_id uuid not null,

    split_order smallint not null,
    -- `run 1`, `100 pull ups`, `300 squats`.
    label text not null,

    reps integer,
    distance_km numeric,
    -- The timing figure as written in the source.
    elapsed_seconds numeric,
    -- Duration of this segment alone. Null when it cannot be derived safely.
    split_seconds numeric,
    -- True when elapsed_seconds is cumulative rather than a standalone duration.
    is_cumulative boolean not null default false,
    -- What elapsed_seconds is measured from, verbatim from the source.
    reference_frame text not null default 'segment',

    pace_seconds_per_km numeric,
    heart_rate_bpm smallint,
    cadence_spm numeric,
    notes text,
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint benchmark_splits_id_user_id_key unique (id, user_id),
    constraint benchmark_splits_benchmark_result_id_split_order_key
        unique (benchmark_result_id, split_order),

    constraint benchmark_splits_benchmark_result_id_user_id_fkey
        foreign key (benchmark_result_id, user_id)
        references public.benchmark_results (id, user_id)
        on delete cascade,

    constraint benchmark_splits_split_order_check check (split_order > 0),
    constraint benchmark_splits_label_check check (length(btrim(label)) > 0),
    -- Mirrors BenchmarkSplitDraftSchema.referenceFrame.
    constraint benchmark_splits_reference_frame_check
        check (reference_frame in ('segment', 'workout_start', 'movement_block_start', 'unknown')),
    constraint benchmark_splits_elapsed_seconds_check
        check (elapsed_seconds is null or elapsed_seconds >= 0),
    constraint benchmark_splits_split_seconds_check
        check (split_seconds is null or split_seconds >= 0)
);

comment on table public.benchmark_splits is
    'Ordered splits of one benchmark attempt. Composite FK to benchmark_results.';

comment on column public.benchmark_splits.split_seconds is
    'This segment alone. NULL unless the subtraction from elapsed_seconds is unambiguous.';

comment on column public.benchmark_splits.reference_frame is
    'What elapsed_seconds was measured from. Murph mixes frames within one cell.';

create index if not exists benchmark_splits_user_id_idx
    on public.benchmark_splits (user_id);

create index if not exists benchmark_splits_benchmark_result_id_user_id_idx
    on public.benchmark_splits (benchmark_result_id, user_id);

create or replace trigger benchmark_splits_set_updated_at
    before update on public.benchmark_splits
    for each row
    execute function public.set_updated_at();
