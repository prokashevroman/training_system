import { SessionDraftSchema, cellLocalDate, parseImportRequestKey } from "@training/domain";
import { describe, expect, it } from "vitest";
import { CELLS } from "./fixtures.js";
import { parseCell, type CellInput } from "./parse.js";

const SHEET = "Training programm 2026";

function cell(locator: string): CellInput {
  const m = /^R(\d+)C(\d+)$/.exec(locator)!;
  const row = Number(m[1]);
  const col = Number(m[2]);
  return { sheet: SHEET, row, col, localDate: cellLocalDate(row, col), rawText: CELLS[locator]! };
}

const parse = (locator: string) => parseCell(cell(locator));

describe("one date can hold several sessions — acceptance criterion 11", () => {
  const result = parse("R17C3");

  it("splits R17C3 into two sessions on 2026-04-14", () => {
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.every((s) => s.localDate === "2026-04-14")).toBe(true);
  });

  it("makes the first a strength session and the second the bike commute", () => {
    const [gym, commute] = result.sessions;
    expect(gym!.activities[0]!.modality).toBe("strength");
    expect(gym!.activities[0]!.strengthSets.length).toBeGreaterThan(0);
    expect(commute!.activities[0]!.modality).toBe("cycling");
    expect(commute!.activities[0]!.objective).toBe("commute");
  });

  it("gives each session a distinct locator-bearing idempotency key", () => {
    const keys = result.sessions.map((s) => s.clientRequestKey);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      const parsed = parseImportRequestKey(key)!;
      expect(parsed).toMatchObject({ sheet: SHEET, row: 17, col: 3 });
    }
  });
});

describe("treadmill speed — acceptance criterion 15", () => {
  const result = parse("R5C6"); // `Treadmill easy run 6 km, speed = 7.0`

  it("preserves the speed value while asserting no unit", () => {
    const activity = result.sessions[0]!.activities[0]!;
    expect(activity.modality).toBe("running");
    expect(activity.distanceKm).toBe(6);
    const speed = activity.details.speed as { value: number; unit: string | null };
    expect(speed.value).toBe(7);
    expect(speed.unit).toBeNull();
  });

  it("warns rather than guessing km/h or mph", () => {
    expect(result.warnings.map((w) => w.code)).toContain("AMBIGUOUS_SPEED_UNIT");
  });
});

describe("Full Murph end to end — acceptance criterion 10", () => {
  const result = parse("R24C8");

  it("produces exactly one session on 2026-06-07", () => {
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]!.localDate).toBe("2026-06-07");
  });

  it("records the benchmark with a 58:52 total and cumulative splits", () => {
    const benchmark = result.sessions[0]!.activities[0]!.benchmark!;
    expect(benchmark.definitionSlug).toBe("murph");
    expect(benchmark.totalSeconds).toBe(3532);
    expect(benchmark.splits.length).toBeGreaterThan(0);
    expect(benchmark.splits.some((s) => s.isCumulative)).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("CUMULATIVE_TIMING");
  });
});

describe("machine settings and per-hand loads survive to the session draft", () => {
  it("keeps `value = 6` as a machine setting with no kilograms (criterion 12)", () => {
    const sets = parse("R15C6").sessions.flatMap((s) =>
      s.activities.flatMap((a) => a.strengthSets),
    );
    const pulldown = sets.find((s) => s.originalText.includes("lat pulldown"))!;
    expect(pulldown.loadScope).toBe("machine_setting");
    expect(pulldown.loadKg).toBeNull();
    expect(pulldown.loadValue).toBe(6);
  });

  it("keeps `8x20 kg in each hand` as per_hand at 20 (criterion 13)", () => {
    const sets = parse("R30C2").sessions.flatMap((s) =>
      s.activities.flatMap((a) => a.strengthSets),
    );
    const row = sets.find((s) => s.originalText.includes("in each hand"))!;
    expect(row.loadScope).toBe("per_hand");
    expect(row.loadValue).toBe(20);
  });

  it("keeps the Cyrillic-x pound load convertible and traceable (criterion 14)", () => {
    const sets = parse("R12C2").sessions.flatMap((s) =>
      s.activities.flatMap((a) => a.strengthSets),
    );
    const lb = sets.find((s) => s.loadUnit === "lb")!;
    expect(lb.loadValue).toBe(155);
    expect(lb.loadKg).toBeCloseTo(70.31, 2);
    expect(lb.reps).toBe(4);
    // The `Bench press:` header line names the exercise for the sets under it.
    expect(lb.exercise.rawText.toLowerCase()).toContain("bench press");
  });
});

describe("rowing splits become intervals", () => {
  it("records a 1000 m row with its 500 m split (R26C3)", () => {
    const activities = parse("R26C3").sessions.flatMap((s) => s.activities);
    const rowing = activities.find((a) => a.modality === "rowing")!;
    expect(rowing.cardioIntervals).toHaveLength(1);
    expect(rowing.cardioIntervals[0]!.distanceKm).toBe(1);
    expect(rowing.cardioIntervals[0]!.splitSecondsPer500m).toBeCloseTo(134.9, 1);
  });
});

describe("every draft satisfies the shared schema", () => {
  it.each(Object.keys(CELLS))("%s produces schema-valid sessions", (locator) => {
    for (const session of parse(locator).sessions) {
      const parsed = SessionDraftSchema.safeParse(session);
      if (!parsed.success) {
        throw new Error(`${locator}: ${JSON.stringify(parsed.error.issues, null, 2)}`);
      }
    }
  });

  it("never emits a session with zero activities", () => {
    for (const locator of Object.keys(CELLS)) {
      for (const s of parse(locator).sessions) expect(s.activities.length).toBeGreaterThan(0);
    }
  });

  it("never derives a kilogram figure from a machine setting or a unitless load", () => {
    for (const locator of Object.keys(CELLS)) {
      for (const s of parse(locator).sessions) {
        for (const a of s.activities) {
          for (const set of a.strengthSets) {
            if (set.loadScope === "machine_setting") expect(set.loadKg).toBeNull();
            if (set.loadUnit === "none") expect(set.loadKg).toBeNull();
          }
        }
      }
    }
  });
});

describe("line accounting — the basis of acceptance criterion 9", () => {
  it("gives every non-empty source line exactly one disposition", () => {
    for (const locator of Object.keys(CELLS)) {
      const input = cell(locator);
      const result = parseCell(input);
      const sourceLines = input.rawText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      expect(result.outcomes.length, `${locator} line count`).toBe(sourceLines.length);
    }
  });

  it("partitions outcomes into consumed and unconsumed with nothing left over", () => {
    for (const locator of Object.keys(CELLS)) {
      const r = parse(locator);
      expect(r.consumedLines.length + r.unconsumedLines.length).toBe(r.outcomes.length);
    }
  });
});
