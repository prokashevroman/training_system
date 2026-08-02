-- 0008_import_staging.sql
--
-- The workbook import is staged, reviewable and idempotent. Nothing reaches
-- workout_sessions until a staged entry is approved, and rerunning the importer
-- must never duplicate a day.
--
-- IDENTITY, the load-bearing decision here:
--
--   import_entries: unique (user_id, sheet_name, source_row, source_col)
--
-- Exactly one staging row per source cell, forever. Rerunning the importer
-- upserts that row and compares `raw_text_sha256`; an unchanged checksum means
-- nothing to re-parse, a changed one means the workbook was edited and the
-- entry returns to review. The alternative — a row per import run — makes
-- "has this cell already been handled?" a question about run ordering.
--
-- The companion key is workout_sessions.client_request_key from 0004:
-- `import:{sheet}:{row}:{col}:{ordinal}`, unique per user. The ordinal exists
-- because one cell can legitimately produce several sessions (R20C6 holds a
-- swim and a run), so cell identity alone cannot key the output.

-- ---------------------------------------------------------------------------
-- import_batches
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    file_name text not null,
    -- sha256 of the source file. Identifies which revision of the workbook a
    -- run read, independent of the file name.
    file_sha256 text,
    sheet_name text not null,

    -- Both versions are recorded: a reparse is only comparable to a previous
    -- run if we know which code produced each.
    importer_version text not null,
    parser_version text not null,

    started_at timestamptz not null default now(),
    finished_at timestamptz,

    status public.import_batch_status not null default 'running',

    -- Counters, filled in as the run progresses. Nullable-free because a count
    -- of nothing is genuinely zero, unlike a training metric.
    cells_scanned integer not null default 0,
    entries_created integer not null default 0,
    entries_parsed integer not null default 0,
    entries_review_required integer not null default 0,
    entries_applied integer not null default 0,
    entries_failed integer not null default 0,
    sessions_created integer not null default 0,

    error_summary text,
    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint import_batches_id_user_id_key unique (id, user_id),

    constraint import_batches_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint import_batches_file_name_check check (length(btrim(file_name)) > 0),
    constraint import_batches_sheet_name_check check (length(btrim(sheet_name)) > 0),
    constraint import_batches_file_sha256_check
        check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
    constraint import_batches_finished_at_check
        check (finished_at is null or finished_at >= started_at)
);

comment on table public.import_batches is
    'One importer run. Records file/sheet, importer + parser versions, counts, status.';

create index if not exists import_batches_user_id_idx
    on public.import_batches (user_id);

create index if not exists import_batches_user_id_started_at_idx
    on public.import_batches (user_id, started_at desc);

create index if not exists import_batches_user_id_status_idx
    on public.import_batches (user_id, status);

create or replace trigger import_batches_set_updated_at
    before update on public.import_batches
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- import_entries
-- ---------------------------------------------------------------------------

create table if not exists public.import_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    -- The run that most recently touched this cell. The entry outlives the run.
    batch_id uuid not null,

    sheet_name text not null,
    source_row integer not null,
    source_col integer not null,
    -- Human-facing `R{row}C{col}`, as used throughout the reconciliation
    -- reports. Stored rather than computed so reports and rows agree verbatim.
    cell_ref text not null,

    -- The free-text week label as written (`Week 09 Feb 23 March 1`). Kept for
    -- cross-checking, never used as the source of truth for the date.
    week_label text,
    -- Derived from the week anchor: 2025-12-29 + 7*(week-1) + (col-2).
    inferred_local_date date,

    raw_text text not null,
    -- Change detection. Rerunning the importer compares this: unchanged means
    -- nothing to re-parse, changed means the workbook was edited.
    raw_text_sha256 text not null,

    -- The deterministic parser's output (a ParseResult), the optional AI draft,
    -- and the Zod validation outcome. Kept separate so the two parsers can be
    -- compared and the AI can be removed without losing the deterministic path.
    extraction jsonb,
    ai_draft jsonb,
    validation jsonb,
    -- ParseWarning[] from packages/domain/src/warnings.ts.
    warnings jsonb not null default '[]'::jsonb,
    -- Source lines no matcher consumed. Acceptance criterion 9 asserts every
    -- non-empty line is either consumed or listed here.
    unconsumed_lines text[] not null default '{}',

    review_status public.import_review_status not null default 'pending',
    reviewed_at timestamptz,
    review_notes text,
    error_message text,
    applied_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint import_entries_id_user_id_key unique (id, user_id),

    -- ----------------------------------------------------------------------
    -- IDENTITY: one staging row per source cell, always.
    -- ----------------------------------------------------------------------
    constraint import_entries_user_id_sheet_name_source_row_source_col_key
        unique (user_id, sheet_name, source_row, source_col),

    constraint import_entries_batch_id_user_id_fkey
        foreign key (batch_id, user_id)
        references public.import_batches (id, user_id)
        on delete cascade,

    constraint import_entries_sheet_name_check check (length(btrim(sheet_name)) > 0),
    constraint import_entries_source_row_check check (source_row > 0),
    constraint import_entries_source_col_check check (source_col > 0),
    constraint import_entries_raw_text_sha256_check
        check (raw_text_sha256 ~ '^[0-9a-f]{64}$'),
    constraint import_entries_warnings_array_check
        check (jsonb_typeof(warnings) = 'array'),
    constraint import_entries_extraction_object_check
        check (extraction is null or jsonb_typeof(extraction) = 'object'),
    constraint import_entries_ai_draft_object_check
        check (ai_draft is null or jsonb_typeof(ai_draft) = 'object'),
    constraint import_entries_validation_object_check
        check (validation is null or jsonb_typeof(validation) = 'object')
);

comment on table public.import_entries is
    'One row per source cell, unique on (user_id, sheet_name, source_row, source_col).';

comment on column public.import_entries.raw_text_sha256 is
    'Change detection: an unchanged checksum on rerun means nothing to re-parse.';

comment on column public.import_entries.inferred_local_date is
    'Computed from the week anchor. week_label is only ever a cross-check.';

create index if not exists import_entries_user_id_idx
    on public.import_entries (user_id);

create index if not exists import_entries_batch_id_user_id_idx
    on public.import_entries (batch_id, user_id);

-- The review queue: this user's entries still needing a decision.
create index if not exists import_entries_user_id_review_status_idx
    on public.import_entries (user_id, review_status);

create index if not exists import_entries_user_id_inferred_local_date_idx
    on public.import_entries (user_id, inferred_local_date);

create or replace trigger import_entries_set_updated_at
    before update on public.import_entries
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- import_entry_sessions
-- ---------------------------------------------------------------------------
--
-- Which sessions an entry produced. A join table rather than a column on
-- workout_sessions because one cell can yield several sessions, and because the
-- provenance link must survive a session being edited afterwards.

create table if not exists public.import_entry_sessions (
    user_id uuid not null,
    import_entry_id uuid not null,
    session_id uuid not null,
    -- The `{ordinal}` in the client_request_key this session was created with.
    ordinal smallint not null default 1,
    created_at timestamptz not null default now(),

    constraint import_entry_sessions_pkey primary key (import_entry_id, session_id),

    constraint import_entry_sessions_import_entry_id_user_id_fkey
        foreign key (import_entry_id, user_id)
        references public.import_entries (id, user_id)
        on delete cascade,
    constraint import_entry_sessions_session_id_user_id_fkey
        foreign key (session_id, user_id)
        references public.workout_sessions (id, user_id)
        on delete cascade,

    constraint import_entry_sessions_ordinal_check check (ordinal > 0)
);

comment on table public.import_entry_sessions is
    'Provenance: which workout_sessions one staged cell produced. Composite FKs both legs.';

create index if not exists import_entry_sessions_user_id_idx
    on public.import_entry_sessions (user_id);

create index if not exists import_entry_sessions_session_id_user_id_idx
    on public.import_entry_sessions (session_id, user_id);
