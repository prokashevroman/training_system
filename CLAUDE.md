# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A voice-first personal training log. Training is stored as **structured data** —
sessions, activities, sets, intervals, circuits, benchmarks — not one free-text cell
per day. A pnpm workspace: React PWA + Cloudflare Worker + Supabase Postgres, plus a
one-off-but-repeatable importer for a historical Excel workbook.

Phases 0–4 of `training_app_coding_agent_brief.md` exist. Phases 5–7 (planning engine,
LLM planning, analytics) do not — and the Phase 5 config/planning tables are
deliberately **not** created, so don't add references to them.

## Commands

```bash
pnpm install                        # the whole workspace; never install wrangler globally
pnpm -r test                        # every vitest suite; no database, no network
pnpm typecheck                      # tsc --noEmit everywhere
pnpm lint                           # see the lint baseline note below
pnpm format                         # prettier --write .
```

Single package / single file / single test. Note the `exec` form for the last two:
`pnpm --filter X test -- <path>` silently drops the argument and runs the whole suite.

```bash
pnpm --filter @training/domain test
pnpm --filter @training/import-workbook exec vitest run src/parsers/strength.test.ts
pnpm --filter @training/ai-worker exec vitest run -t "rejects audio larger"
pnpm --filter @training/domain test:watch   # every package but apps/web has test:watch
```

Python (extractor date logic only — everything else is TypeScript):

```bash
uv run --project scripts/import-workbook pytest scripts/import-workbook/python
```

Database (needs Docker):

```bash
pnpm db:start                       # supabase start
pnpm db:reset                       # migrations + seed.sql
pnpm db:test                        # pgTAP RLS tests
pnpm --filter @training/db-types gen # regenerate row types from the LOCAL db
```

Generators — run these after touching the domain, or the drift tests fail:

```bash
pnpm gen:sql-enums                             # -> supabase/migrations/0001_extensions_and_enums.sql
pnpm --filter @training/domain gen:seed-sql    # -> supabase/seed.sql
```

Import pipeline (writing needs `--local` or `--remote`; **dry-run is the default**):

```bash
pnpm import:inspect                 # -> docs/reports/workbook-profile.{md,json}
pnpm import:extract                 # xlsx -> data/staging/cells.jsonl
pnpm import:run -- --dry-run        # parse + validate, writes nothing
pnpm import:run -- --local          # apply; rerunning must not change row counts
pnpm import:run -- counts           # row counts for IMPORT_USER_ID
pnpm import:reconcile               # -> docs/reports/import-reconciliation.md + review-queue.json
```

Other stages: `preparse`, `parse`, `validate`, `apply` (the default), `reconcile`,
`counts`. Flags: `--batch-size N`, `--from-entry R17C3` to resume. `--ai` throws on
purpose.

The three-terminal local loop, and e2e:

```bash
supabase start                                  # tab 1
cd apps/ai-worker && npx wrangler dev           # tab 2 — :8787
pnpm --filter @training/web dev                 # tab 3 — :5173
pnpm test:e2e                                   # Playwright; needs local Supabase WITH the import applied
```

### Lint baseline

`pnpm lint` currently exits 1 on two pre-existing errors that predate any change you
make (`no-irregular-whitespace` in `packages/domain/src/exercise-library.ts`, a
`prefer-const` in `scripts/import-workbook/src/parse.ts`). A lint failure is only your
problem if the error is in a file you touched. `pnpm typecheck` and `pnpm -r test` are
green and should stay that way.

## The governing rule

> The database stores facts. Deterministic code enforces rules. The LLM interprets and
> transcribes — and never writes unvalidated data.

Concretely: the workbook import calls no model at all, and the Worker returns only
text — a transcript, or a notation rewrite of chaotic entry text that the browser
re-parses with the deterministic parser before anything is shown or saved. It holds
no service-role key and cannot reach the database, so everything that persists
travels from the browser through RLS-protected APIs.

## Architecture

### Dependency direction

```text
packages/domain/          Zod schemas, enums, units, workbook date math. Pure, no I/O.
                          Depends on NOTHING. Everything else depends on it.
packages/ai-contracts/    Worker request/response schemas, error codes, limits. No Cloudflare types.
packages/db-types/        Generated Supabase row types (`supabase gen types`).
apps/web/                 Vite + React 19 + Tailwind PWA. React Query + supabase-js.
apps/ai-worker/           Cloudflare Worker. POST /v1/transcriptions + /v1/normalizations.
scripts/import-workbook/  Python extract (openpyxl) -> TypeScript parse/apply.
```

### 1. The domain model exists exactly once, and generates SQL

`packages/domain` is the single source of truth. Two SQL artefacts are **generated**
from it and guarded by byte-for-byte drift tests (`src/enums.test.ts`,
`src/exercise-library.test.ts`): migration `0001` (from `src/enums.ts`) and
`supabase/seed.sql` (from the exercise and benchmark libraries). Adding an enum value
in TypeScript without running the generator fails the suite rather than failing later
against real data.

Enum-vs-table follows one rule: **closed** vocabularies (modality, objective, load
scope, statuses) are native Postgres enums; **open**, user-extensible ones (exercises,
aliases, tags, benchmark definitions) are reference tables.

The workbook date invariant is the one thing implemented twice —
`packages/domain/src/workbook.ts` and `scripts/import-workbook/python/workbook_dates.py`
— because the extractor cannot import TypeScript. Both pin the same fixtures. **Change
either one and you must change both** (`LAST_DATA_ROW` in particular moves whenever a
new week is imported).

### 2. Ownership is structural, not disciplined

Every child table carries a denormalized `user_id`, so every RLS policy is the same
index-friendly `user_id = auth.uid()`. A child whose `user_id` disagrees with its
parent is made _impossible_ rather than defended with triggers: parents carry
`unique (id, user_id)` and children reference them with a **composite FK**
`(parent_id, user_id)`. Preserve this pattern on any new table. Reference tables have
no `user_id`: RLS on, one read policy for authenticated users, no write policy at all.

Client code never filters by `user_id` — RLS already does, and a second copy of the
rule is a second place to drift. See the header comment in `apps/web/src/lib/queries.ts`.

### 3. Traceability is enforced, not reported

Every session carries `client_request_key` under `unique (user_id, client_request_key)`.
For imports it is `import:{sheet}:{row}:{col}:{ordinal}` — simultaneously the
idempotency key and the `R{row}C{col}` source locator, so every row resolves back to
its workbook cell and a rerun upserts instead of duplicating. Voice sessions use
`voice:{uuid}`.

`reconcile.test.ts` fails if any source line is neither consumed by a structured record
nor listed as unconsumed. Coverage is an assertion, not prose.

### Import data flow

xlsx → `extract.py` → `data/staging/cells.jsonl` → `normalize.ts` → `split.ts` →
`classify.ts` → `parsers/*` → `parse.ts` (drafts + warnings + line dispositions) → Zod
validate → `apply.ts` → `public.apply_import_entry(jsonb)` (migration `0011`).

Two things worth knowing:

- **Apply goes through one SQL function** because a single cell can produce several
  sessions with nested children and must land all-or-nothing. It is `security invoker`,
  so RLS still applies and it cannot escape ownership rules.
- **The extractor auto-anchors the grid.** The 2026-08 workbook prepended a monthly
  plan-template block that shifted the training grid down 23 rows. `extract.py` anchors
  on the `Week 01` label and re-bases rows so Week 01 is always row 2, keeping every
  idempotency key stable across layout drift. Corpus pins (cell count, source-line
  count) live in `reconcile.test.ts` and move with the workbook.

### Paste entry reuses the importer's parser

Every text path on the Record screen — voice transcript, typed text, pasted
spreadsheet notation (`Seated cable row, 3x10 (45kg)`) — lands in one structuring
form, `PasteEntryForm`. It calls
`parseCell` from `@training/import-workbook/parse` — the _same_ deterministic parser
the workbook import runs, exposed through that package's `exports` map so only the pure
entry point is reachable from the browser. No model, no network.

`apps/web/src/lib/paste-queries.ts` rewrites four fields on the parser's output and
nothing else, driven by an `EntryOrigin` (`manual` paste vs a handed-over `voice`
transcript): `source` (the parser stamps `excel_import`), `transcript`,
`clientRequestKey` (`paste:{uuid}:{ordinal}` or `voice:{uuid}:{ordinal}`), and
`rawText`, which becomes the **verbatim entry** — the original pasted bytes, or the
pre-tidy text when the AI rewrite ran. That last one matters — `parseCell` normalizes
before splitting (`97,5`→`97.5`, `×`→`x`, CRLF→LF, runs of spaces collapsed) and each
draft's `rawText` is the normalized slice, but `raw_text` is the column the schema
promises every record stays re-derivable from. Every session from one paste carries the
whole paste, because `extractCommutes` reorders lines across units, so an exact
per-session slice would be a guess.

Two things happen to the text before `parseCell` sees it, both visible in the UI:

- `extractLeadingDate` (`packages/domain/src/entry-date.ts`) lifts a leading `31.08:`
  into the date field — day-first, yearless dates resolve to the most recent past —
  so a date line never becomes a junk `other` activity. The full original, date line
  included, still lands in `raw_text`.
- "Tidy with AI" (optional, needs `VITE_AI_WORKER_URL`) sends the text to
  `/v1/normalizations` and replaces the **editable box** with the returned notation.
  It never replaces `raw_text`, and there is an Undo. The rewrite is re-parsed like
  any other text; a session with no unconsumed lines never needs it.

The one-off `scripts/import-workbook/src/tools/restructure-session.ts` applies the same
parse to an already-saved unstructured session in place (same row, same key, `raw_text`
untouched); dry-run by default, `--apply` to write.

From there it is an ordinary `SessionDraft`, so `buildInsertBundle` +
`insertSessionBundle` write it exactly as manual entry does. Warnings and
`unconsumedLines` are rendered before saving rather than dropped — same rule as the
importer.

`buildInsertBundle` writes the **whole** session tree — `workout_sessions`,
`activities`, `strength_sets`, `cardio_intervals`, `circuit_results` +
`circuit_movements`, `benchmark_results` + `benchmark_splits` — with the column
mapping mirroring `public.apply_import_entry` (migration 0011) field for field.
Nothing a parse produces is refused any more (that refusal cost a real interval
workout in Sep 2026); the two guards that remain, both in `record-queries.ts`:

- `unsupportedDraftParts` reports only `tags`, which the parser never emits today —
  it exists so a future parser change fails loudly instead of dropping data.
- `assertExerciseLinksResolvable` / `assertBenchmarkLinksResolvable` refuse to save
  resolved slugs while the exercise or benchmark reference query is still loading,
  because the canonical link would silently land as null on network timing.

Blank lines do **not** reliably separate sessions: the splitter's `mergeAdjacentSameKind`
keeps two strength blocks as one gym session, while a commute or benchmark opens its
own. Product copy has to match that, not the other way round.

Adding a set-notation form to the parser therefore improves both the importer and the
app. Don't fork a second parser into `apps/web`.

### Voice flow (text-only Worker — deliberately)

Recording → `POST /v1/transcriptions` (Whisper) → the transcript lands **directly on
the structuring screen** (`PasteEntryForm`, `source='voice'`, transcript verbatim in
both `raw_text` and `transcript`) — there is no confirm screen in between. Typed text
takes the identical path without the network, as `source='manual'`. On that screen the
deterministic parser runs per keystroke, and when it leaves unread lines the AI rewrite
fires **automatically, once** (debounced, never retried silently, Undo available);
"Save as plain note" is the escape hatch (`useSaveNoteSession`). The flow is
deliberately: speak or type → read the preview → one Save. Never add a step that makes
the athlete do the structuring themselves; that is the product decision of Sep 2026.

The LLM workout **parser** (model → JSON draft) and planner were removed in Aug 2026 as
a product decision and stay removed. What was added back in Sep 2026, on request, is
narrower: `POST /v1/normalizations` rewrites chaotic entry text into the workbook line
notation — **text in, text out**. The model never emits structured data; the browser
runs `parseCell` over the rewrite, the preview shows warnings/unconsumed lines, and
`raw_text` keeps the athlete's original words (the rewrite is never stored). The Worker
pipeline order in `apps/ai-worker/src/app.ts` (request id → CORS → route → bearer
verification → rate limit → provider → handler) is the security contract; keep it.

`VITE_AI_WORKER_URL` is optional: unset means voice and "Tidy with AI" are off and the
rest of the app works, which `e2e/history.spec.ts` asserts.

### Ambiguity produces warnings, not values

This is the rule most likely to be violated by a well-meaning change. The corpus
records four different things with the same shape of number, and collapsing them
corrupts every trend:

- `machine_setting` load scope (`lat pulldown (value = 6)`) keeps `load_kg` **null**,
  always — enforced twice, by a Zod `superRefine` in `packages/domain/src/strength.ts`
  and a SQL `CHECK` in migration `0005`.
- A treadmill `speed = 7.0` asserts no unit (`speedUnit: null` + `AMBIGUOUS_SPEED_UNIT`).
- A bare `4x165` keeps the number and no unit.
- Murph splits are cumulative and shift reference frame mid-cell, so `splitSeconds`
  stays null while `elapsedSeconds` + `referenceFrame` record what was written.

Unparseable text is flagged `review_required` and surfaced in the Import Review screen.
Missing data is recoverable; fabricated data is not. `docs/EXCEL_IMPORT.md` has the full
table of load semantics and set-notation matchers.

## Gotchas that cost real time

- **`apps/web` imports domain modules by relative path, not through the barrel.** This
  keeps each module's graph to the leaves it needs; follow the existing pattern in
  `lib/record-queries.ts` rather than "cleaning up" the deep imports. The barrel is
  nonetheless browser-safe: `sql-enums.ts` and `seed-sql.ts` call `fileURLToPath` at
  module scope and are deliberately excluded from `domain/src/index.ts`, which
  `index.test.ts` asserts. `lib/paste-queries.ts` reaches the barrel transitively
  through the parser, in dev and in the production build.
- **`apps/web` has a separate `vitest.config.ts`** from `vite.config.ts` on purpose
  (vitest 2 bundles vite 5, the app builds on vite 6; mixing plugin type worlds makes
  `tsc` reject the config).
- **`apps/ai-worker/.dev.vars` must exist locally.** It ships `AI_PROVIDER=mock`.
  Without it, `wrangler.jsonc` supplies `AI_PROVIDER=cloudflare` and local development
  makes real, billable inference calls — `wrangler dev` proxies AI to Cloudflare, it
  does not run models locally. For a time-boxed live test:
  `npx wrangler dev --var AI_PROVIDER:cloudflare`.
- **`VITE_SUPABASE_URL` is the bare project URL** — no `/rest/v1`, no trailing slash.
  supabase-js appends `auth/v1` itself, so a suffix sends sign-in to
  `/rest/v1/auth/v1/token` and every login fails with `404 PGRST125`. A _correct_ URL
  rejects a bad password with `400 invalid_credentials`.
- **`SUPABASE_URL` in the Worker is exactly one value**, never comma-split (unlike
  `ALLOWED_ORIGINS`). A second value is swallowed into the string and yields a
  malformed issuer, so every request fails auth. `ALLOWED_ORIGINS` matches origins
  exactly — no wildcards, no suffixes; if Vite falls back to :5174 every voice request
  returns `403 forbidden_origin`.
- **`GET /health` is unauthenticated on purpose** and echoes the resolved provider and
  model IDs — the fastest way to catch a misconfigured deploy.
- **Model IDs are configuration.** `STT_MODEL` in `wrangler.jsonc` is the only place;
  never branch on a model ID in code.
- **Doc counts lag the code.** README/ARCHITECTURE still cite 170 cells and 608 tests
  from earlier commits. Authoritative numbers are the pins in `reconcile.test.ts` and
  whatever the suites currently print. If you change corpus size, update the pins and
  the docs together.

## Data, secrets and what is gitignored

`data/source/` (the workbook) and `data/staging/` are personal health data and are
**never committed**; `data/source/MANIFEST.sha256` pins which file every report refers
to (`shasum -a 256 -c data/source/MANIFEST.sha256`).

Generated reports are split **by content, not by file type**: `workbook-profile.{md,json}`
is committed because it holds only structure and counts; `import-reconciliation.md` and
`review-queue.json` quote raw source lines, so they stay local. Playwright traces
likewise (they screenshot real training data).

The importer is the only thing that uses a service-role key, and its env file is
deliberately _not_ `VITE_`-prefixed so the key can never reach a browser bundle. The
Worker needs no service-role key at all. Only `VITE_`-prefixed vars are exposed to the
browser.

## Deployment

The PWA deploys to Vercel from `main`; `apps/web/vercel.json` rewrites everything to
`/index.html` (without it, `/history` and `/record` 404 on direct load). The three
`VITE_*` variables live in Vercel settings only — every populated env file is
gitignored — and Vite inlines them at build time, so changing one requires a redeploy.

The Worker deploys separately with `npx wrangler deploy` from `apps/ai-worker/`;
editing `vars` changes nothing until a redeploy. The two usually ship together. The
hosted Supabase project is the live database; the local Docker stack is often not
running, so check before assuming `db:*` commands or e2e will work.
`docs/CLOUDFLARE_CHECKLIST.md` is the ordered, step-by-step path (Part 2 onward has
never been executed against a fresh account).

Debug a deployed Worker with `npx wrangler tail --format pretty` or
`--search "<request-id>"`. Logs are metadata only — bearer tokens, audio and transcript
text are never logged at any level. Keep it that way.

## Docs worth reading before a substantial change

- `docs/ARCHITECTURE.md` — how the pieces fit and why; the seams left for Phases 5–7
- `docs/DATA_MODEL.md` — ER diagram, table reference, the constraints that encode rules
- `docs/EXCEL_IMPORT.md` — normalization rules, session splitting, load semantics
- `docs/CLOUDFLARE_CHECKLIST.md` / `CLOUDFLARE_WORKERS_AI_SETUP.md` — the short path and the reference
- `training_app_coding_agent_brief.md` — the original brief; code comments cite its section numbers
