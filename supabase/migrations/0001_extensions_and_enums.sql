-- 0001_extensions_and_enums.sql
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: pnpm gen:sql-enums
--
-- Source of truth: packages/domain/src/enums.ts
-- packages/domain/src/enums.test.ts fails if this file drifts from it.
--
-- Closed vocabularies are native Postgres enums. Open, user-extensible
-- vocabularies (exercises, aliases, tags, benchmark definitions) are reference
-- tables instead — see migrations 0003 and 0006.

create extension if not exists "pgcrypto";

-- What kind of training an activity is. Drives filtering and analytics.
create type public.activity_modality as enum (
    'strength',
    'running',
    'cycling',
    'rowing',
    'ski_erg',
    'swimming',
    'hybrid_conditioning',
    'mobility_recovery',
    'walking_hiking',
    'sport_outdoor',
    'dance',
    'other'
);

-- Why the activity was done. Separate from modality: an easy run and a VO2max run share a modality but not an objective.
create type public.training_objective as enum (
    'max_strength',
    'hypertrophy',
    'power',
    'skill',
    'aerobic_base',
    'tempo_threshold',
    'vo2max',
    'race_specific',
    'hybrid_conditioning',
    'recovery',
    'commute',
    'unknown'
);

-- Coarse intensity classification. Deliberately coarse: the corpus rarely supports more.
create type public.intensity_level as enum (
    'easy',
    'moderate',
    'hard',
    'max',
    'unknown'
);

-- Biomechanical pattern, used to balance weekly hard sets across patterns.
create type public.movement_pattern as enum (
    'squat',
    'hinge',
    'horizontal_push',
    'horizontal_pull',
    'vertical_push',
    'vertical_pull',
    'unilateral_leg',
    'carry',
    'core',
    'locomotion',
    'power',
    'mobility'
);

-- Role of a set within an activity.
create type public.strength_set_type as enum (
    'warmup',
    'working',
    'drop',
    'amrap',
    'test'
);

-- What the recorded load number actually measures. Never collapse these into kilograms.
create type public.load_scope as enum (
    'total',
    'per_hand',
    'per_side',
    'added_bodyweight',
    'bodyweight',
    'machine_setting',
    'unknown'
);

-- Which side a unilateral set was performed on.
create type public.body_side as enum (
    'left',
    'right',
    'both',
    'each'
);

-- Role of an interval within a cardio activity.
create type public.cardio_interval_type as enum (
    'warmup',
    'work',
    'rest',
    'cooldown',
    'split',
    'steady'
);

-- Scoring format of a conditioning circuit.
create type public.circuit_format as enum (
    'amrap',
    'emom',
    'for_time',
    'rounds',
    'interval',
    'chipper',
    'custom'
);

-- Lifecycle of a completed-training record.
create type public.session_status as enum (
    'draft',
    'completed',
    'discarded'
);

-- How the record entered the system. Import provenance must stay visible forever.
create type public.session_source as enum (
    'manual',
    'voice',
    'excel_import',
    'integration'
);

-- Review state of one staged source cell.
create type public.import_review_status as enum (
    'pending',
    'parsed',
    'review_required',
    'approved',
    'applied',
    'rejected',
    'failed'
);

-- Lifecycle of one importer run.
create type public.import_batch_status as enum (
    'running',
    'completed',
    'failed'
);

-- How much a parse warning should block automatic approval.
create type public.warning_severity as enum (
    'info',
    'warning',
    'error'
);

-- How a benchmark result is scored.
create type public.benchmark_scoring as enum (
    'time',
    'rounds_reps',
    'distance',
    'load',
    'custom'
);

-- Original unit a load was written in. `none` means the source stated a bare number.
create type public.load_unit as enum (
    'kg',
    'lb',
    'none'
);

-- Original unit a distance was written in.
create type public.distance_unit as enum (
    'km',
    'm',
    'mi',
    'floors',
    'steps'
);

-- User display preference.
create type public.preferred_units as enum (
    'metric',
    'imperial'
);
