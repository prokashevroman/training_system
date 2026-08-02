-- 0002_profiles.sql
--
-- The athlete profile plus the `updated_at` trigger helper that every later
-- migration reuses.
--
-- `profiles.user_id` is the primary key: exactly one profile per authenticated
-- user. That keeps the RLS predicate identical to every other user-owned
-- table in this schema — `user_id = auth.uid()` — with no special case.

-- ---------------------------------------------------------------------------
-- Shared trigger helper
-- ---------------------------------------------------------------------------

-- Stamps updated_at on every UPDATE. Attached to every mutable table below and
-- in migrations 0003-0009. `search_path` is pinned empty so the function cannot
-- be hijacked by a caller-controlled search path; now() lives in pg_catalog,
-- which is always searched implicitly.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

comment on function public.set_updated_at() is
    'Trigger helper: sets new.updated_at = now() on UPDATE.';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    display_name text,

    -- Every local_date in the schema is derived using this timezone.
    timezone text not null default 'Europe/Amsterdam',
    preferred_units public.preferred_units not null default 'metric',
    -- Voice entries mix English and Russian; this is a display preference, not
    -- a restriction on what the parser accepts.
    default_language text not null default 'en',

    birth_date date,
    height_cm numeric,

    -- Planning inputs. All optional: an unstated preference must not become a
    -- fabricated one.
    preferred_sessions_per_week_min smallint,
    preferred_sessions_per_week_max smallint,
    weekday_max_minutes smallint,
    weekend_max_minutes smallint,
    training_preferences text,
    current_constraints text,
    injury_notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint profiles_timezone_check check (length(btrim(timezone)) > 0),
    constraint profiles_sessions_per_week_check check (
        preferred_sessions_per_week_min is null
        or preferred_sessions_per_week_max is null
        or preferred_sessions_per_week_min <= preferred_sessions_per_week_max
    )
);

comment on table public.profiles is
    'One row per authenticated athlete. RLS predicate: user_id = auth.uid().';

create or replace trigger profiles_set_updated_at
    before update on public.profiles
    for each row
    execute function public.set_updated_at();
