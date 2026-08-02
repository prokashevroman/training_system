import { describe, expect, it } from "vitest";
import { CELLS } from "../fixtures.js";
import { normalizeCellText } from "../normalize.js";
import { splitIntoSessionUnits } from "../split.js";
import { parseBenchmarkUnit } from "./benchmark.js";

const unitsOf = (locator: string) =>
  splitIntoSessionUnits(normalizeCellText(CELLS[locator]!).text).units;

describe("Full Murph — acceptance criterion 10 (R24C8)", () => {
  const unit = unitsOf("R24C8")[0]!;
  const parsed = parseBenchmarkUnit(unit.lines)!;

  it("is one benchmark session", () => {
    expect(unitsOf("R24C8")).toHaveLength(1);
    expect(parsed).not.toBeNull();
    expect(parsed.draft.definitionSlug).toBe("murph");
    expect(parsed.draft.variantLabel).toBeNull();
  });

  it("records a total of 58:52", () => {
    expect(parsed.draft.totalSeconds).toBe(3532);
  });

  it("records that a vest was worn even though its weight is not stated", () => {
    expect(parsed.draft.vestKg).toBeNull();
    expect(parsed.warnings.map((w) => w.code)).toContain("PARTIAL_PARSE");
  });

  it("stores the splits as cumulative and refuses to derive per-movement times", () => {
    expect(parsed.warnings.map((w) => w.code)).toContain("CUMULATIVE_TIMING");

    const pushUps = parsed.draft.splits.find((s) => s.originalText.includes("200 push ups"))!;
    expect(pushUps.reps).toBe(200);
    expect(pushUps.elapsedSeconds).toBe(1755); // 29:15 as written
    expect(pushUps.isCumulative).toBe(true);
    expect(pushUps.referenceFrame).toBe("movement_block_start");
    // The load-bearing assertion: no fabricated per-movement duration.
    expect(pushUps.splitSeconds).toBeNull();
  });

  it("captures every movement of the sequence in order", () => {
    expect(parsed.draft.splits.map((s) => s.reps)).toEqual([null, 100, 200, 300, null]);
    expect(parsed.draft.splits[0]!.originalText).toContain("run 1");
    expect(parsed.draft.splits[4]!.originalText).toContain("run 2");
  });

  it("keeps the original text of the whole unit", () => {
    expect(parsed.draft.originalText).toContain("Full Murph");
    expect(parsed.draft.originalText).toContain("wasn't deep enough");
  });
});

describe("partial Murph variants", () => {
  it("reads `Half murph (19:48):` as the half-murph benchmark (R22C4)", () => {
    const unit = unitsOf("R22C4").find((u) => u.kind === "benchmark")!;
    const parsed = parseBenchmarkUnit(unit.lines)!;
    // The unit opens with `Murph preperation`, whose own total is `Total time: 38:11`.
    expect(parsed.draft.definitionSlug).toBe("murph");
    expect(parsed.draft.totalSeconds).toBe(2291); // 38:11
    expect(parsed.draft.vestKg).toBe(9);
  });

  it("captures the partition strategy verbatim", () => {
    const unit = unitsOf("R22C4").find((u) => u.kind === "benchmark")!;
    const parsed = parseBenchmarkUnit(unit.lines)!;
    expect(parsed.draft.partitionStrategy).toContain("sets of 4 at 30");
  });

  it("reads a percentage variant as a Murph variant, not a new benchmark", () => {
    const parsed = parseBenchmarkUnit(["60% murph (23:11):", "60 pull kipping (6:03)"])!;
    expect(parsed.draft.definitionSlug).toBe("murph");
    expect(parsed.draft.variantLabel).toBe("60% murph");
    expect(parsed.draft.totalSeconds).toBe(1391);
  });

  it("reads `Half murph` as its own benchmark definition", () => {
    const parsed = parseBenchmarkUnit(["Half murph (21:13):", "50 pull kipping"])!;
    expect(parsed.draft.definitionSlug).toBe("half-murph");
    expect(parsed.draft.totalSeconds).toBe(1273);
  });
});

describe("Cindy", () => {
  it("reads `12 rounds cindy bodyweight:` with its round count (R2C3)", () => {
    const parsed = parseBenchmarkUnit(unitsOf("R2C3")[0]!.lines)!;
    expect(parsed.draft.definitionSlug).toBe("cindy");
    expect(parsed.draft.roundsCompleted).toBe(12);
  });

  it("reads `Cindy 11 rounds:` with the count after the name", () => {
    const parsed = parseBenchmarkUnit(["Cindy 11 rounds:", "5 pull ups", "10 push ups"])!;
    expect(parsed.draft.definitionSlug).toBe("cindy");
    expect(parsed.draft.roundsCompleted).toBe(11);
  });

  it("warns when a benchmark has no recorded score", () => {
    const parsed = parseBenchmarkUnit(["Cindy 11 rounds:", "5 pull ups"])!;
    expect(parsed.warnings.map((w) => w.code)).toContain("BENCHMARK_SCORE_MISSING");
  });
});

describe("rejection", () => {
  it("returns null for a unit that does not open a benchmark", () => {
    expect(parseBenchmarkUnit(["Back squat 4x4: 90kg"])).toBeNull();
    expect(parseBenchmarkUnit(["Swimming training"])).toBeNull();
  });
});
