-- 0003_exercise_library.sql
--
-- The canonical exercise vocabulary. This is GLOBAL reference data: it carries
-- no user_id, is readable by every authenticated user, and is writable by none
-- of them. It is populated from supabase/seed.sql and changed only by a
-- migration or the service role.
--
-- Aliases are a separate table rather than an array column because the import
-- pipeline resolves free text (`Deadlifw`, `DL`, `hex bar deadlift`, `lads`)
-- to a canonical slug, and that lookup must be indexed and unambiguous.

-- ---------------------------------------------------------------------------
-- exercises
-- ---------------------------------------------------------------------------

create table if not exists public.exercises (
    id uuid primary key default gen_random_uuid(),
    slug text not null,
    name text not null,
    movement_pattern public.movement_pattern not null,
    primary_muscles text[] not null default '{}',
    secondary_muscles text[] not null default '{}',
    equipment text[] not null default '{}',
    is_unilateral boolean not null default false,
    is_bodyweight boolean not null default false,
    is_active boolean not null default true,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint exercises_slug_key unique (slug),
    -- Matches ExerciseSchema.slug in packages/domain/src/exercise.ts.
    constraint exercises_slug_format_check check (slug ~ '^[a-z0-9-]+$'),
    constraint exercises_name_check check (length(btrim(name)) > 0)
);

comment on table public.exercises is
    'Global exercise library. Reference data: no user_id, read-only to users.';

create index if not exists exercises_movement_pattern_idx
    on public.exercises (movement_pattern);

create index if not exists exercises_is_active_idx
    on public.exercises (is_active);

create or replace trigger exercises_set_updated_at
    before update on public.exercises
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- exercise_aliases
-- ---------------------------------------------------------------------------

create table if not exists public.exercise_aliases (
    id uuid primary key default gen_random_uuid(),
    exercise_id uuid not null references public.exercises (id) on delete cascade,
    alias text not null,
    -- 'en' | 'ru' | 'es' | 'abbr'. Mirrors ExerciseAliasSchema.language.
    language text not null default 'en',
    -- True for known misspellings (`Deadlifw`). The parser resolves them; the
    -- UI must not offer them as suggestions.
    is_misspelling boolean not null default false,
    -- Apparatus qualifiers seen alongside this alias (`on climbers bar`).
    -- Context, never a separate exercise.
    apparatus text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint exercise_aliases_alias_check check (length(btrim(alias)) > 0),
    constraint exercise_aliases_language_check
        check (language in ('en', 'ru', 'es', 'abbr'))
);

comment on table public.exercise_aliases is
    'Free-text -> canonical exercise lookup. Reference data: no user_id.';

-- One alias resolves to exactly one exercise, case-insensitively. This is the
-- constraint that makes alias resolution deterministic.
create unique index if not exists exercise_aliases_alias_lower_idx
    on public.exercise_aliases (lower(alias));

create index if not exists exercise_aliases_exercise_id_idx
    on public.exercise_aliases (exercise_id);

create or replace trigger exercise_aliases_set_updated_at
    before update on public.exercise_aliases
    for each row
    execute function public.set_updated_at();
