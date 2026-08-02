import { describe, expect, it } from "vitest";
import { classifyLine } from "./classify.js";
import { CELLS } from "./fixtures.js";
import { normalizeCellText } from "./normalize.js";
import { splitIntoSessionUnits } from "./split.js";

const split = (locator: string) => splitIntoSessionUnits(normalizeCellText(CELLS[locator]!).text);

describe("commute is always its own session", () => {
  /**
   * Acceptance criterion 11, and the brief's own example: a gym workout plus a
   * bike commute is two sessions on one date.
   */
  it("splits R17C3 into one strength session and one commute", () => {
    const { units, blockCount } = split("R17C3");
    expect(blockCount).toBe(3);
    expect(units).toHaveLength(2);
    expect(units[0]!.kind).toBe("strength");
    expect(units[0]!.lines).toEqual(["Back squat 4x4: 90kg", "Pull-ups: 3x5 (10 kg)"]);
    expect(units[1]!.kind).toBe("commute");
    expect(units[1]!.lines).toEqual(["Bike to & from work"]);
  });

  /**
   * R25C4 has no blank line before the commute, so a pure blank-line split
   * would bury it inside the strength session.
   */
  it("splits a commute out of the middle of a block (R25C4)", () => {
    const { units, blockCount } = split("R25C4");
    expect(blockCount).toBe(1);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.kind).sort()).toEqual(["commute", "strength"]);
  });

  it("collapses several commute lines into a single ride (R30C7 style)", () => {
    const { units } = splitIntoSessionUnits(
      normalizeCellText("Front squat, 3x6 (45kg)\n\nBike to & from work\n(+ extra biking)").text,
    );
    expect(units).toHaveLength(2);
    const commute = units.find((u) => u.kind === "commute")!;
    expect(commute.lines).toEqual(["Bike to & from work", "(+ extra biking)"]);
  });
});

describe("header blocks merge with their body", () => {
  /**
   * `Murph preperation (vest 9 kg):` sits alone in its own block with the
   * run/Cindy/run body after a blank line. Without the merge this benchmark
   * would become two sessions.
   */
  it("merges the Murph-prep header into one benchmark session (R19C7)", () => {
    const { units, blockCount } = split("R19C7");
    expect(blockCount).toBe(2);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe("benchmark");
    expect(units[0]!.lines[0]).toBe("Murph preperation (vest 9 kg):");
    expect(units[0]!.lines).toHaveLength(7);
  });

  it("merges a `N rounds of:` header with its movement list (R29C4)", () => {
    const { units } = split("R29C4");
    expect(units).toHaveLength(1);
    expect(units[0]!.lines[0]).toMatch(/^5 rounds/);
  });
});

describe("a benchmark absorbs its own body and notes", () => {
  /**
   * Acceptance criterion 10: R24C8 is ONE session. Its three blocks are the
   * header, the cumulative splits, and the quality notes. The splits block
   * opens with `run 1 - 8:57`, which classifies as running, and the notes
   * mention squats — neither starts a new workout.
   */
  it("keeps the Full Murph cell as exactly one session (R24C8)", () => {
    const { units, blockCount } = split("R24C8");
    expect(blockCount).toBe(3);
    expect(units).toHaveLength(1);
    expect(units[0]!.kind).toBe("benchmark");
    expect(units[0]!.lines[0]).toBe("Full Murph (vest, total time - 58:52)");
    expect(units[0]!.lines).toContain("300 squats (finished at 39:56)");
    expect(units[0]!.lines).toContain("quality of some squats wasn't deep enough");
  });

  it("does not let a benchmark swallow a following commute (R20C5 style)", () => {
    const { units } = splitIntoSessionUnits(
      normalizeCellText(
        "Murph preperation (vest 9 kg): \n\n20 strict pull-ups\n130 push ups\n\nBike to & from work",
      ).text,
    );
    expect(units).toHaveLength(2);
    expect(units[0]!.kind).toBe("benchmark");
    expect(units[1]!.kind).toBe("commute");
  });

  it("does not treat a passing Murph mention as a benchmark (R22C6)", () => {
    const { units } = split("R22C6");
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.kind)).toEqual(["swimming", "mobility"]);
  });
});

describe("ambiguity is kept together and flagged, not guessed at", () => {
  /**
   * The plan's worked example. No blank lines, several modalities. Splitting
   * on a guess is unrecoverable; merging and warning is a data edit later.
   */
  it("keeps R24C6 as one session with a POSSIBLE_MULTI_SESSION warning", () => {
    const { units } = split("R24C6");
    expect(units).toHaveLength(1);
    expect(units[0]!.warnings.map((w) => w.code)).toContain("POSSIBLE_MULTI_SESSION");
  });

  it("does not warn when a unit holds a single activity kind", () => {
    const { units } = split("R17C3");
    expect(units.flatMap((u) => u.warnings)).toEqual([]);
  });

  it("does not warn inside a benchmark, whose parts are legitimately mixed", () => {
    expect(split("R24C8").units[0]!.warnings).toEqual([]);
  });
});

describe("blank-line separated modalities stay separate", () => {
  // The brief: "Swimming followed by an unrelated run becomes two sessions."
  it("splits swimming, running and cycling in R20C6", () => {
    const { units } = splitIntoSessionUnits(
      normalizeCellText("Swimming training\n\n4 km easy run\n\neasy bike ride").text,
    );
    expect(units.map((u) => u.kind)).toEqual(["swimming", "running", "cycling"]);
  });
});

describe("corpus-wide invariants", () => {
  const all = Object.entries(CELLS).map(([id, raw]) => {
    const normalized = normalizeCellText(raw).text;
    return { id, normalized, result: splitIntoSessionUnits(normalized) };
  });

  /**
   * The reconciliation guarantee at the splitter level: a line may be regrouped
   * but never dropped. Task 10 asserts the same thing across all 170 cells.
   */
  it("assigns every non-empty source line to exactly one unit", () => {
    for (const { id, normalized, result } of all) {
      const source = normalized.split("\n").filter((l) => l.trim().length > 0);
      const assigned = result.units.flatMap((u) => u.lines);
      expect(assigned, `${id} lost or duplicated a line`).toEqual(
        expect.arrayContaining(source.map((l) => l.trim())),
      );
      expect(assigned.length, `${id} line count changed`).toBe(source.length);
    }
  });

  it("numbers unit ordinals from 1 with no gaps", () => {
    for (const { id, result } of all) {
      expect(
        result.units.map((u) => u.ordinal),
        id,
      ).toEqual(result.units.map((_, i) => i + 1));
    }
  });

  it("never emits an empty unit", () => {
    for (const { id, result } of all) {
      for (const u of result.units) expect(u.lines.length, id).toBeGreaterThan(0);
    }
  });

  it("gives every unit a kind that can carry a session", () => {
    for (const { id, result } of all) {
      for (const u of result.units) {
        expect(["metric", "unknown"], `${id} unit ${u.ordinal}`).not.toContain(u.kind);
      }
    }
  });

  it("never starts a unit with a metric line", () => {
    for (const { id, result } of all) {
      for (const u of result.units) {
        expect(classifyLine(u.lines[0]!).kind, `${id} unit ${u.ordinal}`).not.toBe("metric");
      }
    }
  });
});
