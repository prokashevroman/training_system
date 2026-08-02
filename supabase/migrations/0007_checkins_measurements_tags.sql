-- 0007_checkins_measurements_tags.sql
--
-- Readiness, body measurements and tags.
--
-- Tags are user-owned, not global: one athlete's `travel` is not another's, and
-- a shared tag table would need a second RLS shape. They exist alongside — never
-- instead of — the structured modality/objective columns; a tag must not be the
-- only place a fact is recorded.
--
-- The join tables carry user_id and use composite FKs on BOTH sides, so a tag
-- can never be attached across an ownership boundary in either direction.

-- ---------------------------------------------------------------------------
-- daily_checkins
-- ---------------------------------------------------------------------------

create table if not exists public.daily_checkins (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    local_date date not null,

    -- Every field is nullable: a partial check-in is the normal case and must
    -- not be coerced into zeros.
    sleep_hours numeric,
    sleep_quality smallint,
    fatigue smallint,
    stress smallint,
    motivation smallint,
    -- Soreness keyed by body area: {"quads": 3, "lower_back": 1}. A jsonb map
    -- rather than columns because the useful set of areas is open-ended.
    soreness jsonb not null default '{}'::jsonb,
    pain_level smallint,
    pain_notes text,
    resting_heart_rate_bpm smallint,
    hrv_ms numeric,
    is_ill boolean not null default false,
    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint daily_checkins_id_user_id_key unique (id, user_id),
    -- One check-in per athlete per day; a second submission is an update.
    constraint daily_checkins_user_id_local_date_key unique (user_id, local_date),

    constraint daily_checkins_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint daily_checkins_soreness_object_check
        check (jsonb_typeof(soreness) = 'object'),
    constraint daily_checkins_sleep_hours_check
        check (sleep_hours is null or sleep_hours between 0 and 24),
    -- 1..5 subjective scales, matching what the Today screen offers.
    constraint daily_checkins_sleep_quality_check
        check (sleep_quality is null or sleep_quality between 1 and 5),
    constraint daily_checkins_fatigue_check
        check (fatigue is null or fatigue between 1 and 5),
    constraint daily_checkins_stress_check
        check (stress is null or stress between 1 and 5),
    constraint daily_checkins_motivation_check
        check (motivation is null or motivation between 1 and 5),
    constraint daily_checkins_pain_level_check
        check (pain_level is null or pain_level between 0 and 10)
);

comment on table public.daily_checkins is
    'Optional daily readiness. One row per user per local_date; all metrics nullable.';

create index if not exists daily_checkins_user_id_idx
    on public.daily_checkins (user_id);

create index if not exists daily_checkins_user_id_local_date_idx
    on public.daily_checkins (user_id, local_date);

create or replace trigger daily_checkins_set_updated_at
    before update on public.daily_checkins
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- body_measurements
-- ---------------------------------------------------------------------------

create table if not exists public.body_measurements (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    local_date date not null,
    body_weight_kg numeric,
    waist_cm numeric,
    body_fat_percent numeric,
    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint body_measurements_id_user_id_key unique (id, user_id),
    constraint body_measurements_user_id_local_date_key unique (user_id, local_date),

    constraint body_measurements_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint body_measurements_body_weight_kg_check
        check (body_weight_kg is null or body_weight_kg > 0),
    constraint body_measurements_waist_cm_check
        check (waist_cm is null or waist_cm > 0),
    constraint body_measurements_body_fat_percent_check
        check (body_fat_percent is null or body_fat_percent between 0 and 100)
);

comment on table public.body_measurements is
    'Body weight / waist / optional body-fat estimate. One row per user per local_date.';

create index if not exists body_measurements_user_id_idx
    on public.body_measurements (user_id);

create index if not exists body_measurements_user_id_local_date_idx
    on public.body_measurements (user_id, local_date);

create or replace trigger body_measurements_set_updated_at
    before update on public.body_measurements
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------

create table if not exists public.tags (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    slug text not null,
    label text not null,
    color text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tags_id_user_id_key unique (id, user_id),
    constraint tags_user_id_slug_key unique (user_id, slug),

    constraint tags_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint tags_slug_format_check check (slug ~ '^[a-z0-9-]+$'),
    constraint tags_label_check check (length(btrim(label)) > 0)
);

comment on table public.tags is
    'User-owned labels (travel, hotel, murph, deload). Never a substitute for modality/objective.';

create index if not exists tags_user_id_idx
    on public.tags (user_id);

create or replace trigger tags_set_updated_at
    before update on public.tags
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- session_tags
-- ---------------------------------------------------------------------------

create table if not exists public.session_tags (
    user_id uuid not null,
    session_id uuid not null,
    tag_id uuid not null,
    created_at timestamptz not null default now(),

    constraint session_tags_pkey primary key (session_id, tag_id),

    -- Composite on both legs: the session and the tag must both belong to the
    -- same user as the join row, enforced by Postgres rather than by a check.
    constraint session_tags_session_id_user_id_fkey
        foreign key (session_id, user_id)
        references public.workout_sessions (id, user_id)
        on delete cascade,
    constraint session_tags_tag_id_user_id_fkey
        foreign key (tag_id, user_id)
        references public.tags (id, user_id)
        on delete cascade
);

comment on table public.session_tags is
    'Session <-> tag join. Composite FKs on both legs keep ownership consistent.';

create index if not exists session_tags_user_id_idx
    on public.session_tags (user_id);

create index if not exists session_tags_tag_id_user_id_idx
    on public.session_tags (tag_id, user_id);

-- ---------------------------------------------------------------------------
-- activity_tags
-- ---------------------------------------------------------------------------

create table if not exists public.activity_tags (
    user_id uuid not null,
    activity_id uuid not null,
    tag_id uuid not null,
    created_at timestamptz not null default now(),

    constraint activity_tags_pkey primary key (activity_id, tag_id),

    constraint activity_tags_activity_id_user_id_fkey
        foreign key (activity_id, user_id)
        references public.activities (id, user_id)
        on delete cascade,
    constraint activity_tags_tag_id_user_id_fkey
        foreign key (tag_id, user_id)
        references public.tags (id, user_id)
        on delete cascade
);

comment on table public.activity_tags is
    'Activity <-> tag join. Composite FKs on both legs keep ownership consistent.';

create index if not exists activity_tags_user_id_idx
    on public.activity_tags (user_id);

create index if not exists activity_tags_tag_id_user_id_idx
    on public.activity_tags (tag_id, user_id);
