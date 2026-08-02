# Architecture

The state of the system after Phases 0–4. The planning engine and analytics
(Phases 5–7) are not built yet; this document describes what exists and the
seams left for them.

## The governing rule

> The database stores facts. Deterministic code enforces rules. The LLM
> interprets, proposes, and explains — and never writes unvalidated data.

The workbook import is entirely deterministic and calls no model: text it
cannot parse is flagged for review, never guessed. The Worker added in Phase 4
returns drafts only — it holds no service-role key and cannot write to the
database, so an approved draft always travels through RLS-protected APIs from
the browser.

## Layout

```text
packages/domain/            Zod schemas, enums, units — the single source of truth
scripts/import-workbook/    Python extract (openpyxl) + TypeScript parse/apply
supabase/migrations/        0001-0011, ordered
supabase/tests/             pgTAP RLS tests
supabase/seed.sql           GENERATED from packages/domain
data/source/                The workbook. Gitignored; pinned by a checksum manifest.
data/staging/               cells.jsonl. Gitignored.
docs/reports/               Workbook profile (committed); reconciliation (local only)
```

One deliberate absence remains: there is no planner package. The Phase 5
config and planning tables are not created either — nothing references them,
and guessing their columns before the planner exists is the more expensive
error.

## Three ideas carry the design

### 1. The domain model exists exactly once

`packages/domain` is pure TypeScript and Zod with no I/O. Everything else
depends on it and it depends on nothing.

Two artefacts are **generated** from it, each under a byte-for-byte drift test:

| Generated file                                      | From                                                  | Guard                          |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `supabase/migrations/0001_extensions_and_enums.sql` | `src/enums.ts`                                        | `src/enums.test.ts`            |
| `supabase/seed.sql`                                 | `src/exercise-library.ts`, `src/benchmark-library.ts` | `src/exercise-library.test.ts` |

Adding an enum value in TypeScript without running `pnpm gen:sql-enums` fails
the test suite rather than failing later against real data.

The same rule decides enum-versus-table: **closed** vocabularies (modality,
objective, load scope, statuses) are native Postgres enums; **open**,
user-extensible ones (exercises, aliases, tags, benchmark definitions) are
reference tables. One rule, no per-table debate.

The date invariant is the one thing implemented twice — TypeScript for the app
and Python for the extractor — because the extractor cannot import TypeScript.
Both pin the same fixtures so they cannot drift.

### 2. Ownership is structural, not disciplined

Every child table carries a denormalized `user_id`, so every RLS policy is the
identical, index-friendly `user_id = auth.uid()`.

The obvious risk is a child whose `user_id` disagrees with its parent's. Rather
than defend that with triggers, it is made impossible:

```sql
-- parent
constraint workout_sessions_id_user_id_key unique (id, user_id)

-- child
constraint activities_session_id_user_id_fkey
    foreign key (session_id, user_id)
    references public.workout_sessions (id, user_id)
    on delete cascade
```

Postgres now refuses the mismatch. The pattern is applied to every parent/child
pair in the schema, and `supabase/tests/` asserts both cross-user denial on
child tables and composite-FK rejection of a mismatched `user_id`.

Reference tables (`exercises`, `exercise_aliases`, `benchmark_definitions`)
have no `user_id`: RLS is on, with a single read policy for authenticated users
and no write policy at all.

### 3. Traceability is enforced, not reported

Every session carries
`client_request_key = import:{sheet}:{row}:{col}:{ordinal}` under
`unique (user_id, client_request_key)`. That single column is at once the
idempotency key and the source locator, so every imported row resolves back to
its workbook cell and rerunning the import upserts instead of duplicating.

Coverage is likewise an assertion: `reconcile.test.ts` fails if any of the 550
source lines is neither consumed by a structured record nor listed as
unconsumed. Currently 548 are consumed and 2 are listed by name.

## Data flow

```text
        Hoja de cálculo ... .xlsx        (gitignored, checksum-pinned)
                  |
   inspect.py     |  extract.py           Python + openpyxl
                  v
        data/staging/cells.jsonl          170 records, schema-checked on read
                  |
   normalize.ts -> split.ts -> classify.ts
                  |
   parsers/{strength,cardio,circuit,benchmark,load}.ts
                  |
             parse.ts                     SessionDraft[] + warnings + line dispositions
                  |
   validate (Zod) |  apply.ts
                  v
   public.apply_import_entry(...)         one transaction per cell
                  |
                  v
             Supabase Postgres            RLS on every user-owned table
                  |
           reconcile.ts                   coverage report + review queue
```

## Choices worth knowing

**Python does extraction only.** `openpyxl` is the right tool for xlsx and has
no good TypeScript equivalent, but letting Python own the domain model would
mean maintaining it twice. So Python emits JSONL and stops. The JSONL schema is
validated on read, and each record's `raw_text_sha256` is recomputed, so a hand
edit to the staging file cannot slip an altered cell into the import.

**Apply goes through a SQL function.** PostgREST gives one transaction per
request, but a cell can produce several sessions with nested activities, sets,
intervals and splits, and a cell must land all-or-nothing. Migration `0011`
defines `apply_import_entry`, which takes the whole cell as JSONB. It is
`security invoker`, so RLS still applies and it cannot be used to escape
ownership rules.

**The importer uses a service-role key; nothing else does.** Its env file is
deliberately not `VITE_`-prefixed, so the key can never reach a browser bundle.
When the Cloudflare Worker arrives in Phase 4 it will validate a user's bearer
token and return drafts — the browser saves through normal RLS-protected APIs,
keeping the Worker out of the data-approval path entirely.

**Ambiguity produces warnings, not values.** A treadmill `speed = 7.0` has no
unit, so no unit is asserted. A lat-pulldown `value = 6` is a pin position, so
`load_kg` stays null — enforced by Zod and by a SQL `CHECK`. A bare `4x165`
could be kilograms or pounds, so only the number is kept. Missing data is
recoverable; fabricated data is not.

## Seams left open

| Phase         | Seam already in place                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 3 — PWA       | `SessionDraft` is the shape the UI will edit; review queue is JSON                                            |
| 4 — Voice     | `ParseResult` matches the brief's parser response contract, including `unconsumedLines`; `--ai` flag reserved |
| 5 — Planning  | Config/planning tables deliberately not created; nothing references them                                      |
| 7 — Analytics | Every metric keeps its original value and unit alongside the canonical one                                    |

## Testing

| Suite        | Command                                                                          | Count           |
| ------------ | -------------------------------------------------------------------------------- | --------------- |
| Domain       | `pnpm --filter @training/domain test`                                            | 125             |
| Import       | `pnpm --filter @training/import-workbook test`                                   | 196             |
| Python dates | `uv run --project scripts/import-workbook pytest scripts/import-workbook/python` | 69              |
| RLS          | `supabase test db`                                                               | requires Docker |

Every numeric assertion in the import suite traces to a fixture taken verbatim
from a real cell — `src/fixtures.ts` is generated from the workbook rather than
transcribed, so the Cyrillic `х`, the stray quote and the leading blank line
are all exactly as the source has them.
