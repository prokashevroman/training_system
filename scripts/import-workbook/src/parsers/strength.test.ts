import { describe, expect, it } from "vitest";
import { normalizeCellText } from "../normalize.js";
import { expandSets, parseStrengthLine } from "./strength.js";

/** Lines arrive at the parser already normalized, so tests normalize too. */
const parse = (line: string) => parseStrengthLine(normalizeCellText(line).text);
const sets = (line: string) => expandSets(parse(line)!);

describe("the nine set-notation variants named in the plan", () => {
  it("5x5: 1x80, 3x85, 1x90 -> five sets at three loads", () => {
    const s = sets("Back squat 5x5: 1x80, 3x85, 1x90");
    expect(s).toHaveLength(5);
    expect(s.map((x) => x.load.value)).toEqual([80, 85, 85, 85, 90]);
    expect(s.every((x) => x.reps === 5)).toBe(true);
  });

  /**
   * Cyrillic x, and the reading that proves detail context matters: `4x70`
   * here is 4 REPS, because the header supplied only a set count. Reading it
   * as 4 sets would total 7 sets against a declared 4.
   */
  it("4 sets: 4х70; 3 - 3х75 -> 1 set of 4 plus 3 sets of 3", () => {
    const p = parse("Bench press: 4 sets: 4х70; 3 - 3х75")!;
    expect(p.specs).toHaveLength(2);
    expect(p.specs[0]).toMatchObject({ sets: 4, reps: 4 });
    expect(p.specs[0]!.load.value).toBe(70);
    expect(p.specs[1]).toMatchObject({ sets: 3, reps: 3 });
    expect(p.specs[1]!.load.value).toBe(75);
  });

  it("4x4: (1-90kg, 3-95kg) -> parenthesised detail with dash separators", () => {
    const s = sets("Back squat 4x4: (1-90kg, 3-95kg)");
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.load.value)).toEqual([90, 95, 95, 95]);
    expect(s.every((x) => x.load.unit === "kg")).toBe(true);
  });

  it("4 sets x3: 3x95; 1x100 -> header supplies reps, detail supplies sets", () => {
    const s = sets("Back squats: 4 sets x3: 3x95; 1x100");
    expect(s).toHaveLength(4);
    expect(s.map((x) => x.load.value)).toEqual([95, 95, 95, 100]);
    expect(s.every((x) => x.reps === 3)).toBe(true);
  });

  it("4 sets: 80kg x6 -> weight-first detail", () => {
    const s = sets("Back squat, 4 sets: 80kg x6");
    expect(s).toHaveLength(4);
    expect(s.every((x) => x.reps === 6 && x.load.value === 80)).toBe(true);
  });

  it("2x4 + 2x5 (52kg) -> two blocks sharing one load", () => {
    const p = parse("Bench press: 2x4 + 2x5 (52kg)")!;
    expect(p.matcher).toBe("strength.summed-set-blocks");
    expect(p.specs).toEqual([
      expect.objectContaining({ sets: 2, reps: 4 }),
      expect.objectContaining({ sets: 2, reps: 5 }),
    ]);
    expect(expandSets(p)).toHaveLength(4);
    expect(p.specs[0]!.load.value).toBe(52);
  });

  it("4x4: x95 -> a load with no count applies to every declared set", () => {
    const s = sets("Back squat 4x4: x95");
    expect(s).toHaveLength(4);
    expect(s.every((x) => x.reps === 4 && x.load.value === 95)).toBe(true);
  });

  it("keeps `(90kg last one)` as a note instead of inventing a fifth set", () => {
    const p = parse("Back squat, 4 sets: 80kg x6 (90kg last one)")!;
    expect(expandSets(p)).toHaveLength(4);
    expect(p.specs[0]).toMatchObject({ reps: 6 });
    expect(p.warnings.map((w) => w.code)).toContain("PARTIAL_PARSE");
    expect(p.warnings.some((w) => w.sourceFragment.includes("90kg last one"))).toBe(true);
  });

  it("keeps the messy `(60kg 1st, 5 reps 65 lasst)` variation verbatim", () => {
    const p = parse("Bench press, 4 sets: 65kg x6 (60kg 1st, 5 reps 65 lasst)")!;
    expect(expandSets(p)).toHaveLength(4);
    expect(p.specs[0]!.load.value).toBe(65);
    expect(p.warnings.some((w) => w.sourceFragment.includes("lasst"))).toBe(true);
  });
});

describe("load scope — the distinction that must not collapse", () => {
  // Acceptance criterion 12.
  it("4x10 lat pulldown (value = 6) -> machine_setting with load_kg null", () => {
    const s = sets("4x10 lat pulldown (value = 6)");
    expect(s).toHaveLength(4);
    expect(s[0]!.load.scope).toBe("machine_setting");
    expect(s[0]!.load.kg).toBeNull();
    expect(s[0]!.load.value).toBe(6);
  });

  it("treats `weight 5` and `rowing on 7` as machine settings too", () => {
    expect(
      parse("Single-arm lateral raise cable, 3 sets: 3*15 each hand weight 5")!.specs[0]!.load,
    ).toMatchObject({ scope: "machine_setting", kg: null });
  });

  // Acceptance criterion 13.
  it("8x20 kg in each hand -> per_hand with load_value 20", () => {
    const p = parse("Chest-supported row, 4 sets: 30 degrees incline, 8x20 kg in each hand")!;
    const load = p.specs[p.specs.length - 1]!.load;
    expect(load.scope).toBe("per_hand");
    expect(load.value).toBe(20);
    expect(load.unit).toBe("kg");
  });

  it("14kg in each hand on a split squat -> per_hand", () => {
    const p = parse("Bulgarian split squat, 3 sets x 8reps each leg (14kg in each hand)")!;
    expect(p.specs[0]!.load.scope).toBe("per_hand");
    expect(p.specs[0]!.load.value).toBe(14);
  });

  it("each leg -> per_side", () => {
    const p = parse("Cable leg curl, 3 sets x15 reps each leg (7.5kg)")!;
    expect(p.specs[0]!.load.scope).toBe("per_side");
    expect(p.specs[0]!.load.value).toBe(7.5);
  });

  it("a weighted pull-up records added_bodyweight, not total", () => {
    expect(parse("Weighted strict pull-up: 4x5 (5kg)")!.specs[0]!.load.scope).toBe(
      "added_bodyweight",
    );
  });

  it("120 push-ups (10 kg) -> added_bodyweight", () => {
    const p = parse("120 push-ups (10 kg)")!;
    expect(p.specs[0]!.load.scope).toBe("added_bodyweight");
    expect(p.specs[0]!.reps).toBe(120);
  });

  it("a barbell lift is total, not added_bodyweight", () => {
    expect(parse("Bench press 5x5 (60 kg)")!.specs[0]!.load.scope).toBe("total");
    expect(parse("Deadlift with Hex bar: 4X4 (107 kg)")!.specs[0]!.load.scope).toBe("total");
  });
});

describe("units", () => {
  // Acceptance criterion 14: `4х155lb` in R12C2, written with Cyrillic ha.
  it("4х155lb -> 4 reps at 155 lb, 70.31 kg, original text retained", () => {
    const p = parse("4х155lb")!;
    expect(p.specs).toHaveLength(1);
    const spec = p.specs[0]!;
    expect(spec.reps).toBe(4);
    expect(spec.load.value).toBe(155);
    expect(spec.load.unit).toBe("lb");
    expect(spec.load.kg).toBeCloseTo(70.31, 2);
    expect(spec.load.originalText).toContain("155lb");
  });

  it("5x155lb x2 -> two sets of five reps at 155 lb", () => {
    const p = parse("5x155lb x2")!;
    expect(p.specs[0]).toMatchObject({ sets: 2, reps: 5 });
    expect(p.specs[0]!.load.unit).toBe("lb");
  });

  it("4x165 -> records the number but refuses to guess a unit", () => {
    const p = parse("4x165")!;
    const load = p.specs[0]!.load;
    expect(load.value).toBe(165);
    expect(load.unit).toBe("none");
    expect(load.kg).toBeNull();
    expect(p.warnings.map((w) => w.code)).toContain("UNKNOWN_LOAD_UNIT");
  });

  it("210 or 215lb -> records no load at all and says why", () => {
    const p = parse("Back squat: 4x4 210 or 215lb")!;
    const load = p.specs[0]!.load;
    expect(load.value).toBeNull();
    expect(load.kg).toBeNull();
    expect(p.warnings.map((w) => w.code)).toContain("AMBIGUOUS_LOAD_VALUE");
  });

  it("handles the decimal comma after normalization", () => {
    const s = sets("Deadlift 5x4: 1x90, 3x95, 1x97,5");
    expect(s[4]!.load.value).toBe(97.5);
  });
});

describe("holds and bodyweight reps", () => {
  it("Plank: 4x1 min -> four sets of a 60 second hold", () => {
    const s = sets("Plank: 4x1 min");
    expect(s).toHaveLength(4);
    expect(s[0]!.holdSeconds).toBe(60);
  });

  it("11 strict pull ups -> one set of 11 with no load", () => {
    const p = parse("11 strict pull ups")!;
    expect(p.specs[0]).toMatchObject({ sets: 1, reps: 11 });
    expect(p.specs[0]!.load.value).toBeNull();
  });
});

describe("set-count reconciliation", () => {
  it("warns when the detail does not add up to the declared set count", () => {
    const p = parse("Back squat 5x5: 1x80, 3x85")!;
    expect(p.warnings.some((w) => /accounts for 4/.test(w.message))).toBe(true);
  });

  it("does not warn when the detail adds up", () => {
    const p = parse("Back squat 5x5: 1x80, 3x85, 1x90")!;
    expect(p.warnings.filter((w) => /accounts for/.test(w.message))).toEqual([]);
  });
});

describe("fall-through", () => {
  it("returns null for a line no rule claims, rather than guessing", () => {
    expect(parse("dips attempts")).toBeNull();
    expect(parse("stretching")).toBeNull();
  });
});
