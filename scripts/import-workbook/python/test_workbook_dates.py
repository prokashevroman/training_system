"""Parity tests for ``workbook_dates``.

Every assertion here is also asserted in ``packages/domain/src/workbook.test.ts``
against the TypeScript implementation. The two suites pin the same fixtures on
purpose: Python derives the dates written into ``data/staging/cells.jsonl`` and
TypeScript re-derives them downstream, so if the implementations ever drift,
one of the two suites has to go red.
"""

from __future__ import annotations

import pytest

import workbook_dates as wd

# All 53 week labels, copied verbatim out of column A of the source workbook
# (`test_fixture_matches_the_workbook` below re-reads them and fails if this
# list ever falls out of date). Note the inconsistency the fixture pins down:
# `Dec`/`March`/`Sept` mix abbreviated and full month names, and the year
# appears only on weeks 01 and 53.
WEEK_LABELS: list[str] = [
    "Week 01 Dec 29, 2025 Jan 4",
    "Week 02 Jan 5 Jan 11",
    "Week 03 Jan 12 Jan 18",
    "Week 04 Jan 19 Jan 25",
    "Week 05 Jan 26 Feb 1",
    "Week 06 Feb 2 Feb 8",
    "Week 07 Feb 9 Feb 15",
    "Week 08 Feb 16 Feb 22",
    "Week 09 Feb 23 March 1",
    "Week 10 March 2 March 8",
    "Week 11 March 9 March 15",
    "Week 12 March 16 March 22",
    "Week 13 March 23 March 29",
    "Week 14 March 30 April 5",
    "Week 15 April 6 April 12",
    "Week 16 April 13 April 19",
    "Week 17 April 20 April 26",
    "Week 18 April 27 May 3",
    "Week 19 May 4 May 10",
    "Week 20 May 11 May 17",
    "Week 21 May 18 May 24",
    "Week 22 May 25 May 31",
    "Week 23 June 1 June 7",
    "Week 24 June 8 June 14",
    "Week 25 June 15 June 21",
    "Week 26 June 22 June 28",
    "Week 27 June 29 July 5",
    "Week 28 July 6 July 12",
    "Week 29 July 13 July 19",
    "Week 30 July 20 July 26",
    "Week 31 July 27 Aug 2",
    "Week 32 Aug 3 Aug 9",
    "Week 33 Aug 10 Aug 16",
    "Week 34 Aug 17 Aug 23",
    "Week 35 Aug 24 Aug 30",
    "Week 36 Aug 31 Sept 6",
    "Week 37 Sept 7 Sept 13",
    "Week 38 Sept 14 Sept 20",
    "Week 39 Sept 21 Sept 27",
    "Week 40 Sept 28 Oct 4",
    "Week 41 Oct 5 Oct 11",
    "Week 42 Oct 12 Oct 18",
    "Week 43 Oct 19 Oct 25",
    "Week 44 Oct 26 Nov 1",
    "Week 45 Nov 2 Nov 8",
    "Week 46 Nov 9 Nov 15",
    "Week 47 Nov 16 Nov 22",
    "Week 48 Nov 23 Nov 29",
    "Week 49 Nov 30 Dec 6",
    "Week 50 Dec 7 Dec 13",
    "Week 51 Dec 14 Dec 20",
    "Week 52 Dec 21 Dec 27",
    "Week 53 Dec 28 Jan 3, 2027",
]

WEEKDAY_BY_COLUMN = {
    2: "Monday",
    3: "Tuesday",
    4: "Wednesday",
    5: "Thursday",
    6: "Friday",
    7: "Saturday",
    8: "Sunday",
}


class TestWeekLabelCrossCheck:
    def test_fixture_has_all_53_labels(self) -> None:
        assert len(WEEK_LABELS) == 53

    # Acceptance criterion 5: all 53 labels match the anchor computation.
    @pytest.mark.parametrize(
        ("week_number", "label"),
        [(i + 1, label) for i, label in enumerate(WEEK_LABELS)],
        ids=[f"week{i + 1:02d}" for i in range(len(WEEK_LABELS))],
    )
    def test_label_matches_the_anchor(self, week_number: int, label: str) -> None:
        check = wd.check_week_label(label)
        assert check.problems == ()
        assert check.ok is True
        assert check.week_number == week_number

    def test_reports_a_mismatch_instead_of_accepting_a_shifted_label(self) -> None:
        check = wd.check_week_label("Week 02 Jan 6 Jan 12")
        assert check.ok is False
        assert "start" in " ".join(check.problems)

    def test_rejects_a_label_with_no_week_number(self) -> None:
        assert wd.check_week_label("Columna 1").ok is False

    def test_sept_normalises_to_september_not_an_unknown_month(self) -> None:
        # `Sept` is the one label spelling whose 3-letter prefix (`sep`) differs
        # from the written abbreviation, so it gets its own assertion.
        check = wd.check_week_label("Week 36 Aug 31 Sept 6")
        assert check.label_dates == ((8, 31), (9, 6))
        assert check.ok is True

    def test_fixture_matches_the_workbook(self) -> None:
        """The embedded fixture must equal column A of the real workbook."""
        extract = pytest.importorskip("extract")
        try:
            path = extract.default_workbook_path()
        except SystemExit as exc:  # workbook is gitignored; may be absent
            pytest.skip(str(exc))
        book = extract.read_workbook(path)
        assert [book.week_labels[row] for row in sorted(book.week_labels)] == WEEK_LABELS


class TestDateDerivation:
    def test_anchors_week_1_on_monday_2025_12_29(self) -> None:
        assert wd.week_start_iso(1) == "2025-12-29"
        assert wd.weekday_name("2025-12-29") == "Monday"

    # Acceptance criterion 5: explicit pre-verified fixtures pinning both year
    # boundaries and both ends of the populated range.
    def test_r2c2_is_monday_2025_12_29(self) -> None:
        """First cell, on the 2025/2026 boundary."""
        assert wd.cell_local_date(2, 2) == "2025-12-29"
        assert wd.weekday_name(wd.cell_local_date(2, 2)) == "Monday"

    def test_r32c7_is_saturday_2026_08_01(self) -> None:
        """Last populated cell."""
        assert wd.cell_local_date(32, 7) == "2026-08-01"
        assert wd.weekday_name(wd.cell_local_date(32, 7)) == "Saturday"

    def test_week_53_day_7_is_sunday_2027_01_03(self) -> None:
        """The 2026/2027 boundary."""
        assert wd.week_end_iso(53) == "2027-01-03"
        assert wd.cell_local_date(54, 8) == "2027-01-03"
        assert wd.weekday_name("2027-01-03") == "Sunday"

    def test_r24c8_is_sunday_2026_06_07(self) -> None:
        """The Full Murph cell."""
        assert wd.cell_local_date(24, 8) == "2026-06-07"
        assert wd.weekday_name(wd.cell_local_date(24, 8)) == "Sunday"

    def test_r17c3_is_tuesday_2026_04_14(self) -> None:
        """The two-session cell."""
        assert wd.cell_local_date(17, 3) == "2026-04-14"
        assert wd.weekday_name(wd.cell_local_date(17, 3)) == "Tuesday"

    def test_r12c2_is_monday_2026_03_09(self) -> None:
        """The Cyrillic-x cell."""
        assert wd.cell_local_date(12, 2) == "2026-03-09"
        assert wd.weekday_name(wd.cell_local_date(12, 2)) == "Monday"

    def test_every_cell_lands_on_the_weekday_its_column_claims(self) -> None:
        for row in range(wd.FIRST_DATA_ROW, wd.LAST_DATA_ROW + 1):
            for col in range(wd.FIRST_DAY_COL, wd.LAST_DAY_COL + 1):
                assert wd.weekday_name(wd.cell_local_date(row, col)) == WEEKDAY_BY_COLUMN[col], (
                    f"R{row}C{col}"
                )

    def test_consecutive_cells_are_one_day_apart_across_a_row_boundary(self) -> None:
        assert wd.cell_local_date(2, 8) == "2026-01-04"
        assert wd.cell_local_date(3, 2) == "2026-01-05"

    def test_week_number_and_day_index_derivation(self) -> None:
        assert wd.week_number_for_row(2) == 1
        assert wd.week_number_for_row(54) == 53
        assert wd.day_index_for_col(2) == 1
        assert wd.day_index_for_col(8) == 7

    def test_week_zero_is_rejected(self) -> None:
        with pytest.raises(ValueError):
            wd.week_start_iso(0)
