# Training system — Phases 0–2 (foundation, schema, workbook import)

## Context

`/Users/roman.prokashev/air/training_system` is an empty git repo (no commits) holding two files: the requirements brief and the source workbook `Hoja de cálculo sin título (2).xlsx`.

Today all training history lives as one free-text cell per day in that workbook. The goal is a voice-first, installable training log where training is **structured data** — sessions, activities, sets, intervals, circuits, benchmarks — so it can be filtered, analyzed, and used to drive adaptive planning.

The brief defines seven phases. This plan covers **Phases 0–2 only**: repo scaffold, Supabase schema with RLS, and the workbook import. That is deliberate — the data model and the import are irreversible in a way UI is not. Once 170 real training records are written under a wrong schema, fixing it means re-deriving history. Phases 3–7 (PWA, Cloudflare voice, planning engine, analytics) follow in later runs against a schema already proven against real data.

### Verified facts about the workbook

I profiled the workbook in full rather than trusting the brief's description. All confirmed:

| Claim                                                   | Status                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sheet `Training programm 2026`, range A1:H54            | Confirmed                                                                                  |
| 170 non-empty day cells, 31 weeks with data (rows 2–32) | Confirmed                                                                                  |
| Rows 33–54 = empty future weeks                         | Confirmed                                                                                  |
| Header row `Columna 1`, `Day 1`…`Day 6`, `Column 8`     | Confirmed — columns B..H are Mon..Sun despite the broken 7th header                        |
| Corpus size                                             | 15,518 chars · 550 non-empty lines · 269 blank-line blocks · median cell 67 chars, max 387 |

**Date derivation is a solved, testable invariant.** `week_start = 2025-12-29 + 7 × (week_number − 1)` reproduces the month/day text in **all 53 week labels**, zero mismatches. Week 31 day 7 = 2026-08-02; Week 53 = 2026-12-28 → 2027-01-03. The importer computes dates from the anchor and _cross-checks_ against the label, instead of parsing inconsistent free text (`Week 01 Dec 29, 2025 Jan 4` vs `Week 53 Dec 28 Jan 3, 2027`).

### Decisions confirmed with the user

1. **Scope:** Phases 0–2 this run.
2. **Import parsing:** deterministic TypeScript parser first; unparseable text is flagged `review_required`, never guessed. The AI stage stays wired in behind an `--ai` flag for later.
3. **Language split:** Python + openpyxl does `inspect` and `extract` only (xlsx → JSONL). TypeScript does preparse/parse/validate/apply against the shared Zod schemas, so the domain model exists once.
4. **Database:** real local Supabase; RLS and the apply stage proven against live Postgres.

---

## Approach

Three ideas carry the design.

**Structural integrity over trigger discipline.** Child tables (`activities`, `strength_sets`, …) carry a denormalized `user_id` so every RLS policy is the identical, index-friendly `user_id = auth.uid()`. Drift is made _structurally impossible_ rather than trigger-maintained: each parent gets `UNIQUE (id, user_id)`, and each child uses a composite FK `(parent_id, user_id) REFERENCES parent (id, user_id) ON DELETE CASCADE`. Postgres then refuses to let a child's `user_id` disagree with its parent's.

**Native ENUMs for closed vocabularies, reference tables for open ones.** Modality, objective, set type, load scope, movement pattern, statuses → Postgres `ENUM`, generated from the same Zod enums the app uses. Exercises, aliases, tags, benchmark and event definitions → tables, because they are user-extensible. One consistent rule, no per-table debate.

**Traceability as an enforced invariant, not a report.** Every line of source text ends up either consumed by a structured record or explicitly listed as unconsumed. Because the corpus is a known 170 cells / 269 blocks / 550 lines, reconciliation becomes an assertion the test suite can fail on, not prose in a document.

---

## File changes

All paths relative to `/Users/roman.prokashev/air/training_system`. Everything is **Create** — the repo is empty.

### Root

| File                                          | Purpose                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`, `pnpm-workspace.yaml`         | pnpm workspaces; `packageManager: pnpm@11.5.2`, `engines.node >=20` (matches `personal_website`)                                                                                                                   |
| `tsconfig.base.json`                          | Strict, `noUnusedLocals`/`noUnusedParameters` (matches `content_efficiency_tool/frontend`)                                                                                                                         |
| `.prettierrc.json`, `eslint.config.js`        | `semi: true, singleQuote: false, trailingComma: "all", printWidth: 100` (from `personal_website`)                                                                                                                  |
| `.gitignore`                                  | `.env*`, `.dev.vars`, `dev-dist`, `.venv`, `node_modules`, import artefacts                                                                                                                                        |
| `.env.example`                                | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                                                                                                                                                      |
| `scripts/import-workbook/.env.import.example` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IMPORT_USER_ID` — deliberately **not** `VITE_`-prefixed so service keys can never reach a bundle (pattern from `dinners_planner_Vite_React_app/.env.import.example`) |
| `README.md`                                   | First-successful-local-run path                                                                                                                                                                                    |

The workbook itself moves to `data/source/` and is **gitignored** — it is personal health data. A committed SHA-256 manifest pins which file the reports refer to.

### `packages/domain` — the single source of truth

Pure TypeScript + Zod, no I/O, colocated `*.test.ts`.

- `src/enums.ts` — modality, objective, movement pattern, set type, load scope, statuses. Exported as Zod enums; a script emits the matching `CREATE TYPE` SQL so DB and app cannot drift.
- `src/units.ts` — lb→kg, miles→km, pace/duration `mm:ss` parsing. Conversions return `{ value, originalValue, originalUnit, isExact }`; ambiguous input returns a warning, never a guess.
- `src/session.ts`, `activity.ts`, `strength.ts`, `cardio.ts`, `circuit.ts`, `benchmark.ts` — the draft schemas the parser emits and the Worker will later reuse.
- `src/warnings.ts` — `ParseWarning { code, message, sourceFragment, severity }`.

### `supabase/migrations` — ordered

| Migration                             | Contents                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `0001_extensions_and_enums.sql`       | `pgcrypto`; all `CREATE TYPE … AS ENUM`                                       |
| `0002_profiles.sql`                   | `profiles` (timezone default `Europe/Amsterdam`), `updated_at` trigger helper |
| `0003_exercise_library.sql`           | `exercises`, `exercise_aliases` (global reference data, read-only to users)   |
| `0004_sessions_and_activities.sql`    | `workout_sessions`, `activities` — parents get `UNIQUE (id, user_id)`         |
| `0005_strength_cardio_circuits.sql`   | `strength_sets`, `cardio_intervals`, `circuit_results`, `circuit_movements`   |
| `0006_benchmarks.sql`                 | `benchmark_definitions`, `benchmark_results`, `benchmark_splits`              |
| `0007_checkins_measurements_tags.sql` | `daily_checkins`, `body_measurements`, `tags`, join tables                    |
| `0008_import_staging.sql`             | `import_batches`, `import_entries`                                            |
| `0009_ai_audit.sql`                   | `ai_runs`, `user_corrections` (tables only; populated in Phase 4)             |
| `0010_rls_policies.sql`               | Enable RLS + policies on every user-owned table                               |

Config/planning tables (`weekly_training_requirements`, `availability_rules`, `equipment_*`, `event_*`, `training_blocks`, `plan_*`) are created in Phase 5, not now — building them before the planner exists would mean guessing at columns.

Two constraints matter most:

- **`import_entries` identity:** `UNIQUE (user_id, sheet_name, source_row, source_col)`, with `raw_text_sha256` as a change-detection column. Rerunning upserts; if the checksum changed, `review_status` resets to `pending`. A cell has one staging row, always.
- **Session traceability:** `workout_sessions.client_request_key` is deterministic — `import:{sheet}:{row}:{col}:{ordinal}` — under `UNIQUE (user_id, client_request_key)`. This is simultaneously the idempotency key and the brief's required source locator: every imported record traces back to its cell.

### `supabase/seed.sql` + `supabase/seeds/`

Canonical exercises and aliases, derived from **the corpus itself** (~70 distinct movements extracted from the 550 lines), merged with the 34-row taxonomy the user already hand-authored at `/Users/roman.prokashev/air/workout_planner/docs/exercises.js` — reused rather than reinvented.

Alias coverage must include the real variants observed: `Deadlifw`/`DL`/`deadlift with Hex bar`/`hex bar deadlift`, `RDL`/`Barbell Romanian deadlift`, `DB`/`db`/`dumbbell`, `MU`, `pull kipping`/`kipping pull-up`, `strict pull ups`/`pull ups strict`/`pull-ups`, `paralets`, `lads` (means _lats_), `kkal` (kcal), `Treadmil`, `Murph preperation`. Apparatus qualifiers (`on climbers bar`, `on pull up station bar`, `on pull kipping`) resolve to the **same** canonical exercise with the apparatus captured as equipment context — not as separate exercises.

Benchmark definitions seeded: Murph, Half Murph, Cindy, 1000 m row, 5 k/10 k/half/marathon.

### `scripts/import-workbook`

Python side (uv + `pyproject.toml`, Python 3.12 venv — matches `content_efficiency_tool`):

- `inspect.py` → `docs/reports/workbook-profile.{md,json}`
- `extract.py` → `data/staging/cells.jsonl`, one record per non-empty cell:
  `{sheet, row, col, day_index, week_label, week_number, local_date, raw_text, raw_text_sha256, workbook_sha256}`

TypeScript side (`src/`), the eight stages as composable modules:

- `normalize.ts` — NFKC; **Cyrillic `х` U+0445 → `x`** and `×` U+00D7 → `x` (both appear as multiplication signs in real cells); decimal comma → dot only between digits; strip stray quotes; whitespace collapse. Every transform is recorded so the original stays reconstructible.
- `split.ts` — cell → session units.
- `classify.ts` — unit → modality/objective.
- `parsers/{strength,running,rowing,intervals,circuit,benchmark,mobility,commute}.ts`
- `apply.ts` — one transaction per cell.
- `reconcile.ts` — emits `docs/reports/import-reconciliation.md`.
- `cli.ts` — `inspect | extract | preparse | parse | validate | apply | reconcile`, with `--dry-run` (default), `--local` (default) / `--remote`, `--batch-size`, `--from-entry`, `--ai` (off).

---

## The two hard parts

### Session splitting

Blank-line blocks are the primary signal (269 of them), then two adjustments:

- **Merge** a header-only block ending in `:` with the block after it. This is what keeps `Murph preperation (vest 9 kg):` + its run/Cindy/run body as _one_ benchmark session (11 cells) rather than two.
- **Split within a block** only on high-confidence standalone markers — principally `Bike to & from work` (48 blocks, 51 mentions), which the brief explicitly requires as its own session.

Anything else ambiguous — e.g. `Massage 1.5 hours / Walk 10 km total / 3x3 strict pull ups` with no blank lines — becomes **one session with several activities** plus a `POSSIBLE_MULTI_SESSION` warning for review. That is the safest reversible choice: modality is preserved on each activity, so no information is lost, and splitting later is a data edit rather than a re-parse.

### Load semantics

The corpus distinguishes four load scopes that must not collapse into "kg":

| Observed text                                                | `load_scope`                                   |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `Back squat 5x5: 1x80, 3x85, 1x90`                           | `total`                                        |
| `8x20 kg in each hand`, `2xDB 18 kg each`, `DB 2x24kg`       | `per_hand`                                     |
| `Weighted strict pull-up: 4x5 (5kg)`, `120 push-ups (10 kg)` | `added_bodyweight`                             |
| `4x10 lat pulldown (value = 6)`, `weight 5`, `rowing on 7`   | `machine_setting` — **never** normalized to kg |
| `210 or 215lb`, `4x165` (no unit)                            | `unknown` + warning                            |

Set notation is handled by an **ordered matcher list**, not one grammar — each matcher is a named, independently tested rule with a confidence, tried in order, falling through to `review_required`. The variants to cover are all real: `5x5: 1x80, 3x85, 1x90` · `4 sets: 4х70; 3 - 3х75` · `4x4: (1-90kg, 3-95kg)` · `4 sets x3: 3x95; 1x100` · `4 sets: 80kg x6` · `2x4 + 2x5 (52kg)` · `4x4: x95` · `Back squat, 4 sets: 80kg x6 (90kg last one)` · `Bench press, 4 sets: 65kg x6 (60kg 1st, 5 reps 65 lasst)`.

Two more traps worth naming: **treadmill `speed = 7.0` carries no unit** — preserved verbatim with `AMBIGUOUS_SPEED_UNIT`, never converted; and the **Full Murph cell records cumulative elapsed times, not splits** (`200 push ups (29:15 after the start of pull ups)`), so `benchmark_splits` stores both `elapsed_seconds` and a nullable derived `split_seconds`, flagged `CUMULATIVE_TIMING`.

---

## Implementation steps

**Task 1 — Scaffold.** pnpm workspace, tsconfig/eslint/prettier, `.gitignore`, env examples, move workbook to gitignored `data/source/` + commit checksum manifest, initial commit (repo currently has none).

**Task 2 — `packages/domain`.** Enums, units, warnings, draft schemas + unit tests. Gate: `pnpm test` green; `pnpm gen:sql-enums` emits enum DDL.

**Task 3 — Migrations + RLS.** Write `0001`–`0010`. Gate: `supabase start` (user starts Docker) then `supabase db reset` applies cleanly.

**Task 4 — pgTAP RLS tests** in `supabase/tests/`. Two seeded users; assert user B cannot select/insert/update/delete any of user A's rows across parents _and_ children, and that the composite FK rejects a mismatched `user_id`. Gate: `supabase test db` green.

**Task 5 — Seeds.** Extract the ~70-movement vocabulary from the corpus, merge with `workout_planner/docs/exercises.js`, write exercises + aliases + benchmark definitions.

**Task 6 — Python `inspect` + `extract`.** Gate: profile report reproduces 170/31/54; `cells.jsonl` has exactly 170 records; all 53 week labels pass the anchor cross-check.

**Task 7 — Normalizer + splitter.** Gate: 269 blocks accounted for; Murph-prep cells merge to one unit; bike-commute lines split out.

**Task 8 — Parsers**, one modality at a time, each with fixtures from real cells.

**Task 9 — Validate + apply.** Transaction per cell, upsert on `client_request_key`. Gate: run twice against local Supabase → identical row counts.

**Task 10 — Reconcile + review queue.** Report + a JSON queue of `review_required` entries. (The import-review _UI_ is deferred to Phase 3 with the rest of the frontend; the queue is inspectable now.)

**Task 11 — Docs.** `ARCHITECTURE.md`, `DATA_MODEL.md` (Mermaid ER), `EXCEL_IMPORT.md`, `README.md`, migration report.

---

## Acceptance criteria

1. `pnpm install && pnpm -r test` passes from a fresh clone.
2. `supabase db reset` applies all migrations with no errors.
3. `supabase test db` passes, including cross-user denial on child tables and composite-FK rejection of mismatched `user_id`.
4. `extract` produces exactly **170** JSONL records; **0** from rows 33–54.
5. All **53** week labels match the anchor computation, and every derived date lands on its expected weekday (Day 1 = Mon … Day 7 = Sun). Explicit fixtures, all pre-verified: R2C2 → 2025-12-29 (Mon, first cell), R32C7 → 2026-08-01 (Sat, last cell), Week 53 day 7 → 2027-01-03 — pinning both year boundaries.
6. Import creates exactly **170** `import_entries`.
7. Running the full import twice produces **identical** row counts in every table.
8. Every created `workout_session` has a `client_request_key` resolving to a `R{row}C{col}` locator.
9. **Every one of the 550 non-empty source lines is either consumed by a structured record or listed as unconsumed** in the reconciliation report. This is asserted in a test, not just reported.
10. R24C8 (Full Murph, 2026-06-07) → **one** session, benchmark result with total 58:52, splits stored as cumulative + `CUMULATIVE_TIMING` warning.
11. R17C3 (`Back squat` + `Pull-ups: 3x5 (10 kg)` + `Bike to & from work`) → **two** sessions on 2026-04-14, proving one date holds several independent sessions.
12. `4x10 lat pulldown (value = 6)` → `load_scope = machine_setting`, `load_kg IS NULL`.
13. `8x20 kg in each hand` → `load_scope = per_hand`, `load_value = 20`.
14. `4х155lb` (Cyrillic `х`, R12C2) → 4 reps at 155 lb, `load_kg ≈ 70.31`, `original_unit = 'lb'`, `original_text` retained.
15. `speed = 7.0` → speed preserved, no unit asserted, `AMBIGUOUS_SPEED_UNIT` warning.
16. Reconciliation report shows the counts the brief's §6.5 requires.
17. `git grep` finds no service-role key, token, or `.env` with real values.

## Verification

```bash
pnpm install
pnpm -r test                                    # domain + parser units
supabase start && supabase db reset             # requires Docker running
supabase test db                                # pgTAP RLS
pnpm import:inspect                             # → docs/reports/workbook-profile.md
pnpm import:extract                             # → 170 records
pnpm import:run -- --dry-run                    # parse + validate, no writes
pnpm import:run -- --local                      # apply
pnpm import:run -- --local                      # rerun: row counts must not change
pnpm import:reconcile                           # → docs/reports/import-reconciliation.md
```

Then manually: query 2026-04-14 and confirm two sessions with correct modalities; open the reconciliation report and read the unconsumed-fragment list — that list is the honest measure of parser coverage, and I will report it verbatim rather than summarizing it as "mostly complete".

## Risks

| Risk                                                                   | Mitigation                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic parser under-covers, leaving many `review_required`      | Acceptable and visible by design — flagged, never guessed. The unconsumed-line list quantifies it exactly. If coverage is poor, the `--ai` stage is already wired for Phase 4.                 |
| Composite-FK RLS pattern is unusual and could complicate later inserts | It is standard Postgres, but Task 4 proves it before any parser work depends on it. Fallback is a `BEFORE INSERT` trigger copying `user_id` from the parent.                                   |
| Silent mis-parse writes _wrong_ structured data — worse than no data   | Every numeric assertion traces to a fixture from a real cell; ambiguity produces warnings rather than values. Original `raw_text` is stored on every session, so any record can be re-derived. |
| Docker not currently running; Supabase CLI not installed               | CLI added as a dev dependency; Tasks 1–2 need no DB, so work starts immediately and pauses only at Task 3 for Docker.                                                                          |
| Deferring config/planning tables causes churn in Phase 5               | Intentional. Nothing in Phases 0–2 references them, and guessing their columns now is the more expensive error.                                                                                |
