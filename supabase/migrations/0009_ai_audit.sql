-- 0009_ai_audit.sql
--
-- Audit trail for AI calls and for human corrections.
--
-- `ai_runs` records metadata only. It must NEVER hold secrets, access tokens or
-- raw audio: the prompt itself is deliberately not a column here, only its
-- version. That keeps a table users can read under RLS from becoming a
-- credential and PII store.
--
-- `user_corrections` is the evaluation dataset. Every time a human edits a draft
-- we keep the draft, the approved result and the changed field paths, so parser
-- quality can be measured against real corrections instead of synthetic cases.

-- ---------------------------------------------------------------------------
-- ai_runs
-- ---------------------------------------------------------------------------

create table if not exists public.ai_runs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    -- `cloudflare_workers_ai`, `openai`, ... plus the concrete model id.
    provider text not null,
    model text not null,
    -- `transcribe`, `parse_session`, `plan_week`, `import_draft`.
    operation text not null,
    -- Version of the prompt template. The prompt TEXT is intentionally absent.
    prompt_version text not null,

    -- Provider-side request id, for correlating with provider logs.
    request_id text,
    status text not null default 'pending',
    latency_ms integer,

    -- Usage and cost when the provider reports them; null when it does not.
    input_tokens integer,
    output_tokens integer,
    total_tokens integer,
    estimated_cost_usd numeric,

    -- Did the response satisfy the Zod schema for this operation?
    schema_valid boolean,
    schema_error_summary text,
    -- Coarse bucket: `timeout`, `rate_limit`, `schema_invalid`, `provider_error`.
    error_category text,
    error_message text,

    -- Optional soft links back to what the run was working on.
    --
    -- Deliberately NOT foreign keys, and this is the one place in the schema
    -- that departs from the composite-FK pattern. An audit row must outlive its
    -- subject: deleting a session must not delete the record that an AI call
    -- was made. A composite FK cannot express that here — `on delete set null`
    -- on (session_id, user_id) would try to null user_id, which is not null,
    -- and per-column `set null (session_id)` needs Postgres 16+. `on delete
    -- cascade` would destroy the audit trail, and `no action` would block the
    -- delete outright. So these stay unconstrained uuids, like
    -- workout_sessions.planned_session_id, and may dangle by design.
    --
    -- Ownership is unaffected: it comes from user_id -> auth.users, which is
    -- what every RLS policy reads.
    session_id uuid,
    import_entry_id uuid,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint ai_runs_id_user_id_key unique (id, user_id),

    constraint ai_runs_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint ai_runs_provider_check check (length(btrim(provider)) > 0),
    constraint ai_runs_model_check check (length(btrim(model)) > 0),
    constraint ai_runs_operation_check check (length(btrim(operation)) > 0),
    constraint ai_runs_status_check
        check (status in ('pending', 'succeeded', 'failed', 'timeout')),
    constraint ai_runs_latency_ms_check check (latency_ms is null or latency_ms >= 0),
    constraint ai_runs_estimated_cost_usd_check
        check (estimated_cost_usd is null or estimated_cost_usd >= 0)
);

comment on table public.ai_runs is
    'AI call metadata only. Never store secrets, tokens, prompts or raw audio here.';

comment on column public.ai_runs.prompt_version is
    'Version identifier of the prompt template. The prompt text is deliberately not stored.';

create index if not exists ai_runs_user_id_idx
    on public.ai_runs (user_id);

create index if not exists ai_runs_user_id_created_at_idx
    on public.ai_runs (user_id, created_at desc);

create index if not exists ai_runs_user_id_operation_idx
    on public.ai_runs (user_id, operation);

create index if not exists ai_runs_user_id_status_idx
    on public.ai_runs (user_id, status);

create or replace trigger ai_runs_set_updated_at
    before update on public.ai_runs
    for each row
    execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_corrections
-- ---------------------------------------------------------------------------

create table if not exists public.user_corrections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,

    -- `import_entry` | `voice_session` | `session_edit`.
    source_kind text not null,
    -- What was proposed, and what the human accepted.
    original_draft jsonb not null,
    approved_result jsonb not null,
    -- Dotted field paths that differ, e.g. {'activities.0.distanceKm'}. Stored
    -- rather than diffed on read so evaluation queries stay cheap.
    changed_fields text[] not null default '{}',
    correction_notes text,
    parser_version text,

    -- Soft links, for the same reason as ai_runs above: this table IS the
    -- evaluation dataset, so a correction must survive the deletion of the
    -- session it was made against.
    session_id uuid,
    import_entry_id uuid,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint user_corrections_id_user_id_key unique (id, user_id),

    constraint user_corrections_user_id_fkey
        foreign key (user_id)
        references auth.users (id)
        on delete cascade,

    constraint user_corrections_source_kind_check
        check (source_kind in ('import_entry', 'voice_session', 'session_edit')),
    constraint user_corrections_original_draft_object_check
        check (jsonb_typeof(original_draft) = 'object'),
    constraint user_corrections_approved_result_object_check
        check (jsonb_typeof(approved_result) = 'object')
);

comment on table public.user_corrections is
    'Draft vs. approved result plus changed field paths. The parser evaluation dataset.';

create index if not exists user_corrections_user_id_idx
    on public.user_corrections (user_id);

create index if not exists user_corrections_user_id_created_at_idx
    on public.user_corrections (user_id, created_at desc);

create index if not exists user_corrections_user_id_source_kind_idx
    on public.user_corrections (user_id, source_kind);

create or replace trigger user_corrections_set_updated_at
    before update on public.user_corrections
    for each row
    execute function public.set_updated_at();
