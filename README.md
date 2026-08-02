# Training system

A voice-first personal training log. Training is stored as **structured data** —
sessions, activities, sets, intervals, circuits, benchmarks — not one free-text
cell per day.

This repository covers **Phases 0–4** of the brief: repository scaffold,
Supabase schema with Row Level Security, the repeatable import of the
historical Excel workbook, the installable PWA, and the Cloudflare voice
Worker. The planning engine and analytics (Phases 5–7) come later.

## First successful local run

Prerequisites: Node >= 20, `pnpm` 11.5.2, [uv](https://docs.astral.sh/uv/), and
Docker running (Supabase local development needs it).

```bash
pnpm install                       # workspace deps, incl. the Supabase CLI
pnpm -r test                       # 608 unit tests, no database needed
```

Put the workbook in `data/source/` (it is gitignored — see below), then:

```bash
pnpm import:inspect                # -> docs/reports/workbook-profile.{md,json}
pnpm import:extract                # -> data/staging/cells.jsonl (170 records)
pnpm import:run -- --dry-run       # parse + validate, writes nothing
pnpm import:reconcile              # -> docs/reports/import-reconciliation.md
```

To write rows you need a database:

```bash
pnpm db:start                      # supabase start (first run pulls images)
pnpm db:reset                      # applies supabase/migrations + seed.sql
pnpm db:test                       # pgTAP RLS tests

cp scripts/import-workbook/.env.import.example scripts/import-workbook/.env.import
# paste SUPABASE_URL + service_role key from `supabase status`, and IMPORT_USER_ID

pnpm import:run -- --local         # apply
pnpm import:run -- --local         # rerun: row counts must not change
```

Then run the app:

```bash
cp apps/web/.env.example apps/web/.env.local
# paste VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from `supabase status`
pnpm --filter @training/web dev     # http://localhost:5173
pnpm test:e2e                       # Playwright, against the imported history
```

Open `2026-04-14` in History and you should see two sessions — a gym workout
and a bike commute — on the same date.

## The source workbook

`data/source/` is gitignored: the workbook is personal health data.
`data/source/MANIFEST.sha256` pins which file every generated report refers to:

```bash
shasum -a 256 -c data/source/MANIFEST.sha256
```

Reports follow the same rule by content, not by file type. The workbook profile
is committed because it holds only structure and counts. The reconciliation
report and the review queue quote raw source lines, so they stay local.

## Import results

170 source cells produce 244 sessions, 271 activities, 408 strength sets, 89
benchmark splits, 44 circuit movements and 13 cardio intervals. Of the 550
non-empty source lines, **548 are consumed by a structured record and 2 are
listed by name** in the reconciliation report — that list, not a summary, is
the honest measure of parser coverage.

13 of 170 entries are flagged `review_required`. Nothing ambiguous is guessed
at: a treadmill `speed = 7.0` keeps its number and asserts no unit, a lat
pulldown `value = 6` never becomes 6 kilograms, and a bare `4x165` keeps the
number without a unit.

## Layout

```text
apps/web/                   Installable PWA (Vite + React + Tailwind)
apps/ai-worker/             Cloudflare Worker: transcribe, parse, plan
packages/domain/            Zod schemas + enums — the single source of truth
packages/ai-contracts/      Provider interfaces and API schemas (no Cloudflare)
packages/db-types/          Generated Supabase row types
scripts/import-workbook/    Python extract (openpyxl) + TypeScript parse/apply
supabase/migrations/        0001-0012, ordered
supabase/tests/             pgTAP RLS tests
e2e/                        Playwright flows against the imported history
docs/                       Architecture, data model, import, Cloudflare setup
```

`supabase/migrations/0001_extensions_and_enums.sql` and `supabase/seed.sql` are
**generated** from `packages/domain` (`pnpm gen:sql-enums`, `pnpm --filter
@training/domain gen:seed-sql`). Tests diff the committed files against the
generators, so the database and the application cannot drift.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — ER diagram and table reference
- [docs/EXCEL_IMPORT.md](docs/EXCEL_IMPORT.md) — the import pipeline in detail
- [docs/CLOUDFLARE_WORKERS_AI_SETUP.md](docs/CLOUDFLARE_WORKERS_AI_SETUP.md) — Cloudflare from zero

## Status

| Phase                                   | State                                                                |
| --------------------------------------- | -------------------------------------------------------------------- |
| 0 — repo, contracts, workbook profile   | Done                                                                 |
| 1 — schema, RLS, seeds                  | Done; 12 migrations apply cleanly, 82 pgTAP assertions pass          |
| 2 — workbook import                     | Done; applied to a live database, rerun-identical row counts         |
| 3 — PWA without AI                      | Done; auth, Today, Record, History, session detail, import review    |
| 4 — Worker and voice                    | Code and guide done; **never run against a real Cloudflare account** |
| 5–7 — planning, LLM planning, analytics | Not started                                                          |

### What is not verified

The Worker's unit tests pass against a mock provider, but no live Cloudflare
inference has ever run: there is no account yet. The model IDs in
`wrangler.jsonc` come from the brief and must be checked against Cloudflare's
current catalogue before the first deploy. Saving a voice draft is deliberately
disabled in the UI until that happens — validating a draft's shape is not the
same as trusting its contents.
