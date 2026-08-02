# Workbook import

How the historical training workbook becomes structured records, and what the
importer refuses to do.

## The source

One sheet, `Training programm 2026`, range A1:H54.

| Fact                    | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| Non-empty day cells     | 170                                                        |
| Weeks with data         | 31 (rows 2–32)                                             |
| Empty future weeks      | rows 33–54                                                 |
| Week labels in column A | 53                                                         |
| Corpus                  | 15,518 chars · 550 non-empty lines · 269 blank-line blocks |

Row 1 is a header whose seventh day column reads `Column 8` rather than
`Day 7`. Columns B..H are Monday..Sunday regardless.

The workbook is **personal health data and is not committed**. Put it in
`data/source/` yourself; `data/source/MANIFEST.sha256` pins which file every
report refers to:

```bash
shasum -a 256 -c data/source/MANIFEST.sha256
```

## Dates are computed, not parsed

The week labels are inconsistent free text — `Week 01 Dec 29, 2025 Jan 4`,
`Week 09 Feb 23 March 1`, `Week 53 Dec 28 Jan 3, 2027`. Month names mix
abbreviated and full forms (`Dec`, `March`, `Sept`), and the year appears only
on weeks 01 and 53. Parsing them as the source of truth would be fragile.

Instead every date is derived from one anchor:

```text
week_number = row - 1
day_index   = col - 1            # col 2 = Day 1 = Monday
week_start  = 2025-12-29 + 7 x (week_number - 1)
local_date  = week_start + (day_index - 1)
```

The labels are then used only to **cross-check**. That reproduces the month and
day text in all 53 labels with zero mismatches, so a future disagreement means
the workbook changed shape — and `extract.py` exits non-zero rather than
writing wrong dates.

The invariant is implemented twice, deliberately: `packages/domain/src/workbook.ts`
for TypeScript and `scripts/import-workbook/python/workbook_dates.py` for the
extractor. Both pin the same fixtures (R2C2 → 2025-12-29, R32C7 → 2026-08-01,
week 53 day 7 → 2027-01-03) so the two implementations cannot drift.

## Pipeline

```bash
pnpm import:inspect              # profile -> docs/reports/workbook-profile.{md,json}
pnpm import:extract              # xlsx -> data/staging/cells.jsonl (170 records)
pnpm import:run -- --dry-run     # parse + validate, writes nothing
pnpm import:run -- --local       # apply to local Supabase
pnpm import:run -- --local       # rerun: row counts must not change
pnpm import:reconcile            # -> docs/reports/import-reconciliation.md
```

Flags: `--dry-run` (default), `--local`, `--remote`, `--batch-size N`,
`--from-entry R17C3` to resume. `--ai` is reserved for Phase 4 and currently
errors out — the deterministic parser is the only parser wired up.

Python owns steps 1–2 because `openpyxl` reads xlsx; TypeScript owns everything
downstream so the domain model exists exactly once.

### Stages

| Stage       | Module                             | What it does                                  |
| ----------- | ---------------------------------- | --------------------------------------------- |
| `inspect`   | `python/inspect_workbook.py`       | Structure and counts only, no training text   |
| `extract`   | `python/extract.py`                | One JSONL record per non-empty cell           |
| `preparse`  | `src/normalize.ts`, `src/split.ts` | Normalize text, split cell into session units |
| `parse`     | `src/parse.ts`, `src/parsers/*`    | Session units into typed drafts               |
| `validate`  | `src/apply.ts`                     | Zod-validate every draft before any write     |
| `apply`     | `src/apply.ts` + migration `0011`  | One transaction per cell                      |
| `reconcile` | `src/reconcile.ts`                 | Coverage report and review queue              |

## Normalization

Every rule was chosen after auditing the actual bytes of all 170 cells. The
audit found exactly two non-ASCII characters in the whole corpus, seven decimal
commas, three `digit*digit` sequences, and one unbalanced quote — so the rules
are narrow enough that they cannot damage text they were not written for.

| Rule                            | Why                                                                       | Example                   |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------- |
| `cyrillic-ha-to-x`              | `х` U+0445 is visually identical to `x` and used as a multiplication sign | `4х155lb` (R12C2)         |
| `multiplication-sign-to-x`      | `×` U+00D7                                                                | `35 × 3` (R24C4)          |
| `asterisk-to-x`                 | only between digits                                                       | `3*15` (R30C2)            |
| `decimal-comma-to-dot`          | only between digits; every `, ` in the corpus is a list separator         | `1x97,5` (R3C2)           |
| `strip-unbalanced-double-quote` | only when the count is odd                                                | `"Cindy 5 rounds:` (R8C4) |
| `collapse-inline-whitespace`    | blank lines are preserved — they are the splitter's primary signal        |                           |

The apostrophes in `didn't` (R24C4) and `wasn't` (R24C8) must survive, which is
why the quote rule targets `"` only and keys on an odd count.

The untouched original is carried alongside the normalized text and every
applied rule is recorded, so normalization is always reconstructible.

## Session splitting

Blank-line blocks are the primary signal, but **a block is not a session**.
Four ordered adjustments turn 269 blocks into 244 sessions:

1. **Merge header blocks.** `Murph preperation (vest 9 kg):` sits alone with
   its run/Cindy/run body in the next block. Without this the benchmark
   becomes two sessions.
2. **Extract commutes.** `Bike to & from work` is always its own session, even
   when it shares a block with strength work (R25C4 has no blank line before
   it). All commute lines in a cell collapse into one ride.
3. **Absorb benchmark bodies.** The Full Murph cell (R24C8) is three blocks:
   header, splits, quality notes. Its body opens with `run 1 - 8:57`, which
   reads as running, so a naive split would tear the benchmark apart.
4. **Merge adjacent same-kind blocks.** R17C3's `Back squat` and `Pull-ups`
   blocks are one gym session.

Anything still ambiguous stays **merged** and is flagged `POSSIBLE_MULTI_SESSION`.
That is the reversible choice: modality is preserved per activity, so splitting
later is a data edit, whereas a wrong split has already destroyed the grouping.

## Load semantics

The corpus records four genuinely different things with the same shape of
number. Collapsing them into one kilogram column would silently corrupt every
strength trend.

| Observed text                                              | `load_scope`       | `load_kg`        |
| ---------------------------------------------------------- | ------------------ | ---------------- |
| `Back squat 5x5: 1x80, 3x85, 1x90`                         | `total`            | derived          |
| `8x20 kg in each hand`, `2xDB 18 kg each`                  | `per_hand`         | derived, flagged |
| `Weighted strict pull-up: 4x5 (5kg)`                       | `added_bodyweight` | derived          |
| `4x10 lat pulldown (value = 6)`, `weight 5`, `rowing on 7` | `machine_setting`  | **null, always** |
| `210 or 215lb`, `4x165`                                    | `unknown`          | **null**, warned |

This is enforced twice: a Zod `superRefine` in
`packages/domain/src/strength.ts` and a SQL `CHECK` in migration `0005`.

### Set notation

Handled by an **ordered matcher list**, not one grammar, because the meaning of
`AxB` depends on what the header already supplied:

```text
Back squat 5x5: 1x80, 3x85, 1x90      header gives reps -> 1,3,1 are SETS (sum = 5)
Bench press: 4 sets: 4x70; 3 - 3x75   header gives no reps -> 4 is REPS
                                      (reading it as sets would total 7 > 4)
```

Both readings appear in the same workbook. Each matcher is named, carries a
confidence, and is tried in order; a line no rule claims falls through to
review rather than being coerced. All nine variants named in the plan are
covered, with tests in `src/parsers/strength.test.ts`.

## Two traps worth naming

**Treadmill speed carries no unit.** `speed = 7.0` (R5C6) is a brisk walk in
km/h and a solid run in mph. The number is preserved with `speedUnit: null` and
an `AMBIGUOUS_SPEED_UNIT` warning. It is never converted.

**Murph splits are cumulative, and shift reference frame mid-cell.** R24C8:

```text
run 1 - 8:57                                        a duration
100 pull ups (10:41 finished after started them)    from the pull-up start
200 push ups (29:15 after the start of pull ups)    from the pull-up start
300 squats (finished at 39:56)                      from the same start
run 2 (5:35, cadencia promedio - 160)               a pace, not a time
```

`elapsedSeconds` holds what was written, `referenceFrame` records what it was
measured from, and `splitSeconds` stays **null** — subtracting across mixed
frames produces plausible numbers that are wrong. The result carries a
`CUMULATIVE_TIMING` warning.

## Idempotency and traceability

Every session carries

```text
client_request_key = import:{sheet}:{row}:{col}:{ordinal}
```

under `unique (user_id, client_request_key)`. It is simultaneously the
idempotency key and the `R{row}C{col}` source locator, so every row in the
database resolves back to the workbook cell it came from.

`apply_import_entry` (migration `0011`) deletes anything a cell produced on a
previous run before inserting, inside one transaction. Children cascade, so a
rerun replaces a cell's rows rather than duplicating them.

## Coverage

Reconciliation is an assertion, not prose: `src/reconcile.test.ts` fails if any
source line is neither consumed nor listed.

| Measure           | Count |
| ----------------- | ----- |
| Cells             | 170   |
| Sessions          | 244   |
| Activities        | 271   |
| Strength sets     | 408   |
| Benchmark splits  | 89    |
| Circuit movements | 44    |
| Cardio intervals  | 13    |
| Source lines      | 550   |
| **Unconsumed**    | **2** |

The two unconsumed lines are `dips attempts` (R3C4) and
`Warm-up: 10 minutes, jumping jacks, joint mobility, push-ups, squats.` (R17C6).
Both are prose with no extractable structure. They are listed, not hidden — the
unconsumed list in `docs/reports/import-reconciliation.md` is the honest
measure of parser coverage.

13 of 170 entries are flagged `review_required`; the queue is written to
`docs/reports/review-queue.json`. The review **UI** is Phase 3.

Neither report is committed: both quote raw source lines, which is health data.
The workbook profile is committed because it contains only structure and counts.
