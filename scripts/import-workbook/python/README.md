# Python side of the workbook import

Two jobs only: **read the xlsx** and **derive the dates**. Nothing here parses
training text — that happens downstream in TypeScript (`../src/`), against the
shared Zod schemas.

## Run

Everything goes through `uv` (system `python3` is 3.9; this project needs 3.12):

```bash
uv run --project scripts/import-workbook python scripts/import-workbook/python/inspect_workbook.py
uv run --project scripts/import-workbook python scripts/import-workbook/python/extract.py
uv run --project scripts/import-workbook pytest scripts/import-workbook/python -q
```

Or via pnpm from the repo root: `pnpm import:inspect`, `pnpm import:extract`.

Paths are resolved from the script's own location, so the cwd does not matter.
The source workbook is the single `.xlsx` in `data/source/` (gitignored personal
health data, pinned by `data/source/MANIFEST.sha256`); override with
`--workbook <path>`.

## Files

| File                     | Role                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `workbook_dates.py`      | Date derivation and the week-label cross-check. A mirror of `packages/domain/src/workbook.ts`.                    |
| `extract.py`             | Reads the workbook; writes `data/staging/cells.jsonl`. Also owns the reader that `inspect_workbook.py` imports.   |
| `inspect_workbook.py`    | Writes `docs/reports/workbook-profile.{md,json}` — structure and counts only, never cell text.                    |
| `test_workbook_dates.py` | Pins the same fixtures as `packages/domain/src/workbook.test.ts`, so the two implementations cannot drift apart.  |

`inspect_workbook.py` importing the reader from `extract.py` is deliberate: the
profile's "170 non-empty cells" and the extractor's "170 records" are only a
meaningful gate if both numbers come from the same code.

## Dates are computed, not parsed

The week labels in column A are inconsistent free text (`Week 01 Dec 29, 2025
Jan 4`, `Week 09 Feb 23 March 1`, `Week 53 Dec 28 Jan 3, 2027` — abbreviated and
full month names mixed, year present only at the two year boundaries). So the
date comes from one anchor:

```
week_number = row - 1                              # row 2 = week 01
day_index   = col - 1                              # col 2 = Day 1 = Monday
week_start  = 2025-12-29 + 7 * (week_number - 1)
local_date  = week_start + (day_index - 1)
```

The label is only **cross-checked** against that, on month and day, matching on
the lowercase 3-letter month prefix (`Sept` → `sep`). All 53 labels currently
pass. If any label ever disagrees, `extract.py` exits non-zero and writes
nothing — the workbook changed shape, and wrong dates are worse than no dates.

## Output contract

`data/staging/cells.jsonl` — one JSON object per non-empty day cell, ordered by
`(row, col)`, with exactly these keys:

```
sheet, row, col, day_index, week_label, week_number, local_date,
raw_text, raw_text_sha256, workbook_sha256
```

`raw_text` is verbatim: no NFKC, no whitespace collapse, no Cyrillic-`х`
substitution. Normalisation is the TypeScript stage's job and is logged there so
the original stays reconstructible. `raw_text_sha256` is SHA-256 of the UTF-8
bytes, and is the change-detection column for `import_entries`.

`extract.py` exits non-zero without writing if the cell count is not 170
(override with `--expect-count`), if any week label fails the cross-check, if a
cell appears outside rows 2–54, or if a row has data but no label.
