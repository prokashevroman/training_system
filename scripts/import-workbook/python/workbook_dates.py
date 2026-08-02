"""Date derivation for the source workbook.

This is a line-for-line mirror of ``packages/domain/src/workbook.ts``. The two
implementations must stay identical: Python derives the dates written into
``data/staging/cells.jsonl``, TypeScript re-derives them downstream. Both test
suites pin the same fixtures (R2C2, R32C7, week 53 day 7, R24C8, R17C3, R12C2
and all 53 week labels) so drift fails a test rather than corrupting history.

The week labels are inconsistent free text -- ``Week 01 Dec 29, 2025 Jan 4``,
``Week 09 Feb 23 March 1``, ``Week 53 Dec 28 Jan 3, 2027`` -- with abbreviated
and full month names mixed, and the year present only at the two year
boundaries. Parsing them as the source of truth would be fragile.

Instead the date is *computed* from a single anchor and the label is used only
to cross-check::

    week_start = 2025-12-29 + 7 * (week_number - 1)

That reproduces the month/day text in all 53 labels with zero mismatches, so a
future disagreement means the workbook changed shape and the import must stop
rather than silently write wrong dates.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

SHEET_NAME = "Training programm 2026"

#: Monday of Week 01. Every date in the workbook derives from this.
WEEK_ANCHOR_ISO = "2025-12-29"

FIRST_DATA_ROW = 2
LAST_DATA_ROW = 32
#: Row 54 is Week 53; rows 33..54 are empty future weeks.
LAST_LABEL_ROW = 54
#: Column B..H are Day 1..Day 7, despite the header reading ``Column 8``.
FIRST_DAY_COL = 2
LAST_DAY_COL = 8

# Month names in the labels are inconsistent (`Dec`, `March`, `Sept`, `June`).
# The lowercase 3-letter prefix is unique across all twelve, so that is what we
# normalise on -- note `Sept` -> `sep`.
MONTHS: dict[str, int] = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

WEEKDAYS = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)

_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_WEEK_RE = re.compile(r"^\s*Week\s+(\d{1,2})\b", re.IGNORECASE)
_DATE_RE = re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})\b")


def _parse_iso(iso: str) -> date:
    m = _ISO_RE.match(iso)
    if not m:
        raise ValueError(f"Not an ISO date: {iso}")
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))


def add_days(iso: str, days: int) -> str:
    return (_parse_iso(iso) + timedelta(days=days)).isoformat()


def week_number_for_row(row: int) -> int:
    """Row 2 is Week 01, row 54 is Week 53."""
    return row - 1


def day_index_for_col(col: int) -> int:
    """Column 2 is Day 1 (Monday), column 8 is Day 7 (Sunday)."""
    return col - 1


def week_start_iso(week_number: int) -> str:
    if week_number < 1:
        raise ValueError(f"Week number must be >= 1, got {week_number}")
    return add_days(WEEK_ANCHOR_ISO, 7 * (week_number - 1))


def week_end_iso(week_number: int) -> str:
    return add_days(week_start_iso(week_number), 6)


def cell_local_date(row: int, col: int) -> str:
    """The local date of one day cell. Day 1 = Monday."""
    return add_days(week_start_iso(week_number_for_row(row)), day_index_for_col(col) - 1)


def weekday_name(iso: str) -> str:
    """``Monday`` .. ``Sunday``. These are calendar dates, not instants."""
    return WEEKDAYS[_parse_iso(iso).isoweekday() % 7]


@dataclass(frozen=True)
class WeekLabelCheck:
    ok: bool
    week_number: int | None
    computed_start: str | None
    computed_end: str | None
    #: ``(month, day)`` pairs read out of the label, in order.
    label_dates: tuple[tuple[int, int], ...] = ()
    problems: tuple[str, ...] = field(default=())


def check_week_label(label: str) -> WeekLabelCheck:
    """Cross-check one free-text week label against the anchor computation.

    Only month and day are compared: the label omits the year except at the two
    year boundaries, and ``Week 53 Dec 28 Jan 3, 2027`` proves the trailing year
    belongs to the *end* date, not the start.
    """
    problems: list[str] = []

    week_match = _WEEK_RE.search(label)
    if not week_match:
        return WeekLabelCheck(
            ok=False,
            week_number=None,
            computed_start=None,
            computed_end=None,
            label_dates=(),
            # json.dumps, not repr: keeps the message byte-identical to the
            # TypeScript mirror's JSON.stringify.
            problems=(f"Label does not start with a week number: {json.dumps(label)}",),
        )
    week_number = int(week_match.group(1))

    label_dates: list[tuple[int, int]] = []
    for m in _DATE_RE.finditer(label):
        month = MONTHS.get(m.group(1)[:3].lower())
        if month is None:
            continue
        label_dates.append((month, int(m.group(2))))

    computed_start = week_start_iso(week_number)
    computed_end = week_end_iso(week_number)

    if len(label_dates) != 2:
        problems.append(f"Expected 2 month/day pairs in the label, found {len(label_dates)}")
    else:
        got_start, got_end = label_dates
        want_start = (int(computed_start[5:7]), int(computed_start[8:10]))
        want_end = (int(computed_end[5:7]), int(computed_end[8:10]))

        if got_start != want_start:
            problems.append(
                f"Week {week_number} start: label says {got_start[0]}/{got_start[1]}, "
                f"anchor computes {want_start[0]}/{want_start[1]}"
            )
        if got_end != want_end:
            problems.append(
                f"Week {week_number} end: label says {got_end[0]}/{got_end[1]}, "
                f"anchor computes {want_end[0]}/{want_end[1]}"
            )

    return WeekLabelCheck(
        ok=not problems,
        week_number=week_number,
        computed_start=computed_start,
        computed_end=computed_end,
        label_dates=tuple(label_dates),
        problems=tuple(problems),
    )
