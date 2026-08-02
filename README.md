# Training system

A voice-first personal training log. Training is stored as **structured data** —
sessions, activities, sets, intervals, circuits, benchmarks — not one free-text
cell per day.

This repository currently covers **Phases 0–2** of the brief: repository
scaffold, Supabase schema with Row Level Security, and the one-time (repeatable)
import of the historical Excel workbook. The PWA, the Cloudflare voice Worker,
and the planning engine (Phases 3–7) come later, against a schema already proven
against real data.

## First successful local run

Prerequisites: Node >= 20, `pnpm` 11.5.2, [uv](https://docs.astral.sh/uv/), and
Docker Desktop running (Supabase local development needs it).

```bash
pnpm install                       # workspace deps, incl. the Supabase CLI
pnpm -r test                       # domain + import unit tests

pnpm db:start                      # supabase start  (first run pulls images)
pnpm db:reset                      # applies supabase/migrations + seed.sql
pnpm db:test                       # pgTAP RLS tests

pnpm import:inspect                # -> docs/reports/workbook-profile.{md,json}
pnpm import:extract                # -> data/staging/cells.jsonl  (170 records)
pnpm import:run -- --dry-run       # parse + validate, writes nothing
```

To actually write rows, copy the importer env example and fill it in:

```bash
cp scripts/import-workbook/.env.import.example scripts/import-workbook/.env.import
# paste SUPABASE_URL + service_role key from `supabase status`, and IMPORT_USER_ID
pnpm import:run -- --local         # apply
pnpm import:run -- --local         # rerun: row counts must not change
pnpm import:reconcile              # -> docs/reports/import-reconciliation.md
```

## The source workbook

`data/source/` is gitignored — the workbook is personal health data. Place the
`.xlsx` there yourself; `data/source/MANIFEST.sha256` pins which file every
generated report refers to:

```bash
shasum -a 256 -c data/source/MANIFEST.sha256
```

## Layout

```text
packages/domain/            Zod schemas + enums — the single source of truth
scripts/import-workbook/    Python extract (openpyxl) + TypeScript parse/apply
supabase/migrations/        Ordered SQL migrations
supabase/tests/             pgTAP RLS tests
docs/                       Architecture, data model, import documentation
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) and
[docs/EXCEL_IMPORT.md](docs/EXCEL_IMPORT.md).
