# Training system

A voice-first personal training log. Training is stored as **structured data** —
sessions, activities, sets, intervals, circuits, benchmarks — not one free-text
cell per day.

This repository currently covers **Phases 0–2** of the brief: repository
scaffold, Supabase schema with Row Level Security, and the repeatable import of
the historical Excel workbook. The PWA, the Cloudflare voice Worker and the
planning engine (Phases 3–7) come later, against a schema already proven
against real data.

## First successful local run

Prerequisites: Node >= 20, `pnpm` 11.5.2, [uv](https://docs.astral.sh/uv/), and
Docker running (Supabase local development needs it).

```bash
pnpm install                       # workspace deps, incl. the Supabase CLI
pnpm -r test                       # 321 unit tests, no database needed
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

Then query `2026-04-14` and confirm two sessions — a gym workout and a bike
commute — on the same date.

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
packages/domain/            Zod schemas + enums — the single source of truth
scripts/import-workbook/    Python extract (openpyxl) + TypeScript parse/apply
supabase/migrations/        0001-0011, ordered
supabase/tests/             pgTAP RLS tests
docs/                       Architecture, data model, import documentation
```

`supabase/migrations/0001_extensions_and_enums.sql` and `supabase/seed.sql` are
**generated** from `packages/domain` (`pnpm gen:sql-enums`, `pnpm --filter
@training/domain gen:seed-sql`). Tests diff the committed files against the
generators, so the database and the application cannot drift.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit and why
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — ER diagram and table reference
- [docs/EXCEL_IMPORT.md](docs/EXCEL_IMPORT.md) — the import pipeline in detail

## Status

| Phase                                 | State                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0 — repo, contracts, workbook profile | Done                                                                                         |
| 1 — schema, RLS, seeds                | Written; `supabase db reset` / `supabase test db` not yet run (needs Docker)                 |
| 2 — workbook import                   | Parse, validate, reconcile verified; `apply` written but not yet run against a live database |
| 3–7                                   | Not started                                                                                  |
