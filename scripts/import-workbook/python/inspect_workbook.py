#!/usr/bin/env python3
"""Profile the source workbook's structure -- never its contents.

    uv run --project scripts/import-workbook python scripts/import-workbook/python/inspect_workbook.py

Writes ``docs/reports/workbook-profile.md`` and ``docs/reports/workbook-profile.json``.

The cells hold personal health data, so this report deliberately carries only
structure and counts: no cell text, no line samples, not even a longest-cell
excerpt. Week labels are included because they are pure calendar text and are
what the anchor cross-check is asserted against.

The reader itself lives in ``extract.py`` -- the profile's "170 non-empty cells"
and the extractor's "170 records" have to come from the same code to be a
meaningful gate.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path
from typing import Any

import workbook_dates as wd
from extract import Workbook, default_workbook_path, read_workbook, repo_root

MD_RELPATH = "docs/reports/workbook-profile.md"
JSON_RELPATH = "docs/reports/workbook-profile.json"

#: A block is a run of lines separated from its neighbours by a blank line.
BLOCK_SPLIT_RE = re.compile(r"\n\s*\n")

LENGTH_BUCKETS: tuple[tuple[int, int | None], ...] = (
    (0, 25),
    (26, 50),
    (51, 75),
    (76, 100),
    (101, 150),
    (151, 200),
    (201, 300),
    (301, None),
)

DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _compress_runs(numbers: list[int]) -> str:
    """``[33, 34, ..., 54]`` -> ``33-54``; keeps the report readable."""
    if not numbers:
        return "(none)"
    parts: list[str] = []
    start = prev = numbers[0]
    for n in numbers[1:]:
        if n == prev + 1:
            prev = n
            continue
        parts.append(str(start) if start == prev else f"{start}-{prev}")
        start = prev = n
    parts.append(str(start) if start == prev else f"{start}-{prev}")
    return ", ".join(parts)


def build_profile(book: Workbook) -> dict[str, Any]:
    cells = book.day_cells
    lengths = sorted(len(c.raw_text) for c in cells)

    all_lines = [line for c in cells for line in c.raw_text.split("\n")]
    non_empty_lines = [line for line in all_lines if line.strip()]

    blocks = 0
    for cell in cells:
        blocks += sum(1 for b in BLOCK_SPLIT_RE.split(cell.raw_text) if b.strip())

    rows_with_data = sorted({c.row for c in cells})
    cells_per_row = {row: sum(1 for c in cells if c.row == row) for row in rows_with_data}
    cells_per_day = {
        col: sum(1 for c in cells if c.col == col)
        for col in range(wd.FIRST_DAY_COL, wd.LAST_DAY_COL + 1)
    }

    distribution = []
    for low, high in LENGTH_BUCKETS:
        count = sum(1 for n in lengths if n >= low and (high is None or n <= high))
        distribution.append(
            {
                "label": f"{low}-{high}" if high is not None else f"{low}+",
                "min": low,
                "max": high,
                "cells": count,
                "share": round(count / len(lengths), 4) if lengths else 0.0,
            }
        )

    label_checks = []
    for row_number in sorted(book.week_labels):
        label = book.week_labels[row_number]
        check = wd.check_week_label(label)
        expected_week = wd.week_number_for_row(row_number)
        problems = list(check.problems)
        if check.week_number is not None and check.week_number != expected_week:
            problems.insert(
                0, f"label says week {check.week_number}, row implies week {expected_week}"
            )
        label_checks.append(
            {
                "row": row_number,
                "week_number": expected_week,
                "label": label,
                "computed_start": check.computed_start,
                "computed_end": check.computed_end,
                "label_dates": [f"{m}/{d}" for m, d in check.label_dates],
                "ok": not problems,
                "problems": problems,
            }
        )

    dates = [wd.cell_local_date(c.row, c.col) for c in cells]

    return {
        "source": {
            "file": book.path.name,
            "sha256": book.sha256,
            "sheet": book.sheet_name,
            "dimensions": book.dimensions,
            "max_row": book.max_row,
            "max_column": book.max_column,
            "header_row": [None if v is None else str(v) for v in book.header],
        },
        "date_derivation": {
            "anchor": wd.WEEK_ANCHOR_ISO,
            "rule": "week_start = 2025-12-29 + 7 * (week_number - 1); local_date = week_start + (day_index - 1)",
            "week_number_from_row": "row - 1",
            "day_index_from_col": "col - 1",
            "first_date": min(dates) if dates else None,
            "last_date": max(dates) if dates else None,
        },
        "structure": {
            "non_empty_day_cells": len(cells),
            "weeks_with_data": len(rows_with_data),
            "rows_with_data": rows_with_data,
            "rows_with_data_compact": _compress_runs(rows_with_data),
            "empty_rows": list(book.empty_rows),
            "empty_rows_compact": _compress_runs(list(book.empty_rows)),
            "week_labels": len(book.week_labels),
            "label_rows_compact": _compress_runs(sorted(book.week_labels)),
            "cells_per_row": cells_per_row,
            "cells_per_day_index": {
                str(wd.day_index_for_col(col)): count for col, count in cells_per_day.items()
            },
            "cells_per_weekday": {
                DAY_NAMES[wd.day_index_for_col(col) - 1]: count for col, count in cells_per_day.items()
            },
        },
        "corpus": {
            "total_characters": sum(lengths),
            "total_lines": len(all_lines),
            "non_empty_lines": len(non_empty_lines),
            "blank_line_blocks": blocks,
            "cell_length": {
                "min": lengths[0] if lengths else 0,
                "median": statistics.median(lengths) if lengths else 0,
                "mean": round(statistics.fmean(lengths), 1) if lengths else 0,
                "p90": lengths[int(0.9 * (len(lengths) - 1))] if lengths else 0,
                "max": lengths[-1] if lengths else 0,
            },
            "length_distribution": distribution,
        },
        "week_label_cross_check": {
            "checked": len(label_checks),
            "passed": sum(1 for c in label_checks if c["ok"]),
            "failed": sum(1 for c in label_checks if not c["ok"]),
            "labels": label_checks,
        },
    }


def render_markdown(profile: dict[str, Any]) -> str:
    src = profile["source"]
    dd = profile["date_derivation"]
    st = profile["structure"]
    co = profile["corpus"]
    xc = profile["week_label_cross_check"]
    length = co["cell_length"]

    out: list[str] = []
    add = out.append

    add("# Workbook profile")
    add("")
    add(
        "Structural profile of the source training workbook, generated by "
        "`scripts/import-workbook/python/inspect_workbook.py`."
    )
    add("")
    add(
        "**No cell text appears in this report.** The cells are personal health data; only "
        "counts, lengths and calendar labels are recorded here."
    )
    add("")

    add("## Source")
    add("")
    add("| Field | Value |")
    add("| --- | --- |")
    add(f"| File | `{src['file']}` (gitignored; pinned by `data/source/MANIFEST.sha256`) |")
    add(f"| SHA-256 | `{src['sha256']}` |")
    add(f"| Sheet | `{src['sheet']}` |")
    add(f"| Dimensions | `{src['dimensions']}` ({src['max_row']} rows x {src['max_column']} columns) |")
    header_cells = " · ".join(f"`{v}`" for v in src["header_row"])
    add(f"| Header row | {header_cells} |")
    add("")
    add(
        "The 7th day header reads `Column 8`, not `Day 7` -- a defect in the sheet, not in the "
        "data. Columns B..H are Monday..Sunday regardless."
    )
    add("")

    add("## Date derivation")
    add("")
    add(
        "Dates are computed from a single anchor and the free-text week label is only "
        "cross-checked against them (see `packages/domain/src/workbook.ts` and "
        "`scripts/import-workbook/python/workbook_dates.py`)."
    )
    add("")
    add("| Field | Value |")
    add("| --- | --- |")
    add(f"| Anchor (Monday of week 01) | `{dd['anchor']}` |")
    add(f"| Rule | `{dd['rule']}` |")
    add(f"| Week number | `{dd['week_number_from_row']}` |")
    add(f"| Day index | `{dd['day_index_from_col']}` (col 2 = Day 1 = Monday) |")
    add(f"| First populated date | `{dd['first_date']}` |")
    add(f"| Last populated date | `{dd['last_date']}` |")
    add("")

    add("## Structure")
    add("")
    add("| Metric | Value |")
    add("| --- | --- |")
    add(f"| Non-empty day cells | **{st['non_empty_day_cells']}** |")
    add(f"| Weeks with data | **{st['weeks_with_data']}** |")
    add(f"| Rows with data | `{st['rows_with_data_compact']}` |")
    add(f"| Rows confirmed empty | `{st['empty_rows_compact']}` (future weeks) |")
    add(f"| Week labels in column A | {st['week_labels']} (rows `{st['label_rows_compact']}`) |")
    add("")
    add("### Cells per weekday")
    add("")
    add("| Day index | Weekday | Cells |")
    add("| --- | --- | --- |")
    for day_index, (weekday, count) in enumerate(st["cells_per_weekday"].items(), start=1):
        add(f"| {day_index} | {weekday} | {count} |")
    add("")
    add("### Cells per week row")
    add("")
    add("| Row | Week | Cells |")
    add("| --- | --- | --- |")
    for row, count in st["cells_per_row"].items():
        add(f"| {row} | {int(row) - 1:02d} | {count} |")
    add("")

    add("## Corpus size")
    add("")
    add("| Metric | Value |")
    add("| --- | --- |")
    add(f"| Total characters | **{co['total_characters']}** |")
    add(f"| Total lines | {co['total_lines']} |")
    add(f"| Non-empty lines | **{co['non_empty_lines']}** |")
    add(f"| Blank-line-separated blocks | **{co['blank_line_blocks']}** |")
    add(f"| Cell length: min | {length['min']} |")
    add(f"| Cell length: median | **{length['median']:g}** |")
    add(f"| Cell length: mean | {length['mean']} |")
    add(f"| Cell length: p90 | {length['p90']} |")
    add(f"| Cell length: max | **{length['max']}** |")
    add("")
    add(
        "Blocks and non-empty lines are the reconciliation denominators: every one of the "
        f"{co['non_empty_lines']} lines must end up either consumed by a structured record or "
        "listed as unconsumed."
    )
    add("")

    add("### Cell length distribution")
    add("")
    add("| Characters | Cells | Share | |")
    add("| --- | ---: | ---: | --- |")
    max_count = max((b["cells"] for b in co["length_distribution"]), default=0)
    for bucket in co["length_distribution"]:
        bar = "#" * round(30 * bucket["cells"] / max_count) if max_count else ""
        add(f"| {bucket['label']} | {bucket['cells']} | {bucket['share'] * 100:.1f}% | `{bar}` |")
    add("")

    add("## Week label cross-check")
    add("")
    add(
        f"All {xc['checked']} labels in column A, compared against the anchor computation on "
        "month and day only (the year appears only on weeks 01 and 53). Month names are "
        "inconsistent -- `Dec`, `March`, `Sept`, `June` -- so matching is on the lowercase "
        "3-letter prefix."
    )
    add("")
    add(f"**{xc['passed']}/{xc['checked']} pass, {xc['failed']} fail.**")
    add("")
    add("| Row | Week | Label | Computed start | Computed end | Label dates | Check |")
    add("| --- | --- | --- | --- | --- | --- | --- |")
    for label in xc["labels"]:
        status = "pass" if label["ok"] else "**FAIL:** " + "; ".join(label["problems"])
        dates = " -> ".join(label["label_dates"]) if label["label_dates"] else "(none)"
        add(
            f"| {label['row']} | {label['week_number']:02d} | `{label['label']}` | "
            f"{label['computed_start']} | {label['computed_end']} | {dates} | {status} |"
        )
    while out and not out[-1]:
        out.pop()
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workbook", type=Path, default=None, help="Override the source .xlsx path")
    args = parser.parse_args(argv)

    root = repo_root()
    workbook_path = args.workbook or default_workbook_path()
    book = read_workbook(workbook_path)
    profile = build_profile(book)

    md_path = root / MD_RELPATH
    json_path = root / JSON_RELPATH
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(render_markdown(profile), encoding="utf-8")
    json_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    xc = profile["week_label_cross_check"]
    st = profile["structure"]
    co = profile["corpus"]
    print(f"sheet          {book.sheet_name} ({book.dimensions})")
    print(f"sha256         {book.sha256}")
    print(f"cells          {st['non_empty_day_cells']} non-empty in {st['weeks_with_data']} weeks "
          f"(rows {st['rows_with_data_compact']})")
    print(f"empty rows     {st['empty_rows_compact']}")
    print(f"corpus         {co['total_characters']} chars, {co['non_empty_lines']} non-empty lines, "
          f"{co['blank_line_blocks']} blocks")
    print(f"cell length    median {co['cell_length']['median']:g}, max {co['cell_length']['max']}")
    print(f"week labels    {xc['passed']}/{xc['checked']} match the anchor computation")
    print(f"wrote          {md_path.relative_to(root)}")
    print(f"wrote          {json_path.relative_to(root)}")
    return 0 if xc["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
