import { describe, expect, it } from "vitest";
import {
  INTENSITIES,
  LOAD_SCOPES,
  LOAD_UNITS,
  MODALITIES,
  OBJECTIVES,
  REVIEW_STATUSES,
  SET_TYPES,
} from "../../lib/record-queries.js";
import { enumLabel } from "./labels.js";

describe("enumLabel", () => {
  it("humanizes snake_case values", () => {
    expect(enumLabel("max_strength")).toBe("Max strength");
    expect(enumLabel("review_required")).toBe("Review required");
  });

  it("uses the override where humanizing would read wrong", () => {
    expect(enumLabel("vo2max")).toBe("VO2max");
    expect(enumLabel("per_hand")).toBe("Each hand");
    expect(enumLabel("machine_setting")).toBe("Machine setting (no kg)");
  });

  it("labels every value the form can offer", () => {
    const values = [
      ...MODALITIES,
      ...OBJECTIVES,
      ...INTENSITIES,
      ...SET_TYPES,
      ...LOAD_UNITS,
      ...LOAD_SCOPES,
      ...REVIEW_STATUSES,
    ];
    for (const value of values) {
      expect(enumLabel(value), value).not.toBe("");
      expect(enumLabel(value), value).not.toContain("_");
    }
  });
});
