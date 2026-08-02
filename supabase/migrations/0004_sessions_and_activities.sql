-- 0004_sessions_and_activities.sql
--
-- The spine of the completed-training model: one date holds zero, one or many
-- sessions; one session holds one or many activities.
--
-- THE OWNERSHIP PATTERN, established here and repeated in 0005-0009:
--
--   * every parent declares `unique (id, user_id)`;
--   * every child carries a denormalized `user_id` and references its parent
--     through a COMPOSITE foreign key `(parent_id, user_id)`.
--
-- The payoff is twofold. Every RLS policy in the whole schema is the identical
-- `user_id = auth.uid()` — no joins, no recursive lookups, index-friendly at
-- every depth. And drift between a child's user_id and its parent's is made
-- structurally impossible rather than trigger-maintained: Postgres itself
-- refuses the mismatched row. Migration 0002's trigger helper copies nothing;
-- there is nothing to copy.

-- ---------------------------------------------------------------------------
-- workout_sessions
-- ---------------------------------------------------------------------------

create table if not exists public.workout_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,

    -- Calendar date in the profile timezone. Derived, never inferred from
    -- created_at, because a session logged after midnight belongs to the day
    -- it was trained.
    local_date date not null,
    started_at timestamptz,

    title text not null,
    source public.session_source not null default 'manual',

    -- Verbatim source text. Never discarded: every structured record must stay
    -- re-derivable from what was actually written or said.
    raw_text text not null default '',
    transcript text,
    notes text,

    duration_seconds numeric,
    session_rpe numeric,
    status public.session_status not null default 'completed',

    -- Set once planned_sessions exists (Phase 5). Deliberately unconstrained
    -- for now rather than guessed at.
    planned_session_id uuid,

    -- Idempotency key AND source locator in one column. Imports write
    -- `import:{sheet}:{row}:{col}:{ordinal}`, so rerunning the import upserts
    -- instead of duplicating and every row resolves back to its workbook cell.
    client_request_key text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Referenced by activities, session_tags, import_entry_sessions and
    -- user_corrections through composite foreign keys.
    constraint workout_sessions_id_user_id_key unique (id, user_id),
    constraint workout_sessions_user_id_client_request_key_key
        unique (user_id, client_request_key),
    constraint workout_sessions_title_check check (length(btrim(title)) > 0),
    constraint workout_sessions_duration_seconds_check
        check (duration_seconds is null or duration_seconds >= 0),
    constraint workout_sessions_session_rpe_check
        check (session_rpe is null or session_rpe between 0 and 10)
);

comment on table public.workout_sessions is
    'One logically coherent completed session. Many sessions may share a local_date.';

comment on column public.workout_sessions.client_request_key is
    'Idempotency key and source locator. Imports use import:{sheet}:{row}:{col}:{ordinal}.';

create index if not exists workout_sessions_user_id_idx
    on public.workout_sessions (user_id);

create index if not exists workout_sessions_user_id_local_date_idx
    on public.workout_sessions (user_id, local_date);

create index if not exists workout_sessions_user_id_status_idx
    on public.workout_sessions (user_id, status);

create index if not exists workout_sessions_user_id_source_idx
    on public.workout_sessions (user_id, source);

create or replace trigger workout_sessions_set_updated_at
    before update on public.workout_sessions
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------------

create table if not exists public.activities (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    session_id uuid not null,

    -- 1-based order within the session.
    sequence smallint not null,

    modality public.activity_modality not null,
    -- Free-form refinement: `air_bike`, `treadmill`, `outdoor`, `hex_bar`.
    subtype text,
    objective public.training_objective not null default 'unknown',
    intensity public.intensity_level not null default 'unknown',

    -- Every metric below is nullable on purpose. A missing distance is missing,
    -- not zero.
    duration_seconds numeric,
    distance_km numeric,
    calories numeric,
    avg_heart_rate_bpm smallint,
    max_heart_rate_bpm smallint,
    cadence_spm numeric,
    elevation_gain_m numeric,
    avg_power_watts numeric,
    -- Load carried during the activity (`vest 9 kg`), not a lifted load.
    external_load_kg numeric,

    -- Modality-specific facts with no column of their own (`floors`, `steps`).
    details jsonb not null default '{}'::jsonb,
    notes text,
    -- Exact source lines this activity was built from. Drives reconciliation.
    original_text text not null default '',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- Referenced by strength_sets, cardio_intervals, circuit_results,
    -- benchmark_results and activity_tags.
    constraint activities_id_user_id_key unique (id, user_id),
    constraint activities_session_id_sequence_key unique (session_id, sequence),

    -- The composite FK. Postgres will not allow user_id to disagree with the
    -- parent session's user_id, in either direction.
    constraint activities_session_id_user_id_fkey
        foreign key (session_id, user_id)
        references public.workout_sessions (id, user_id)
        on delete cascade,

    constraint activities_sequence_check check (sequence > 0),
    constraint activities_details_object_check check (jsonb_typeof(details) = 'object'),
    constraint activities_duration_seconds_check
        check (duration_seconds is null or duration_seconds >= 0),
    constraint activities_distance_km_check
        check (distance_km is null or distance_km >= 0)
);

comment on table public.activities is
    'One modality inside a session. Composite FK to workout_sessions (id, user_id).';

create index if not exists activities_user_id_idx
    on public.activities (user_id);

create index if not exists activities_session_id_user_id_idx
    on public.activities (session_id, user_id);

create index if not exists activities_user_id_modality_idx
    on public.activities (user_id, modality);

create index if not exists activities_user_id_objective_idx
    on public.activities (user_id, objective);

create or replace trigger activities_set_updated_at
    before update on public.activities
    for each row
    execute function public.set_updated_at();
