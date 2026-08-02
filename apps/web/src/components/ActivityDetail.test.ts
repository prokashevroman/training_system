// @vitest-environment node
// Grouping logic only; the rendering is exercised by the dev server, not here.
import type { StrengthSet } from "@training/db-types";
import { describe, expect, it } from "vitest";
import { groupSetsByExercise } from "./ActivityDetail.js";

let counter = 0;

function set(overrides: Partial<StrengthSet>): StrengthSet {
  counter += 1;
  return {
    activity_id: "activity-1",
    apparatus: null,
    completed: true,
    created_at: "2026-07-28T00:00:00Z",
    exercise_confidence: 0.9,
    exercise_id: null,
    exercise_raw_text: "Back squat",
    hold_seconds: null,
    id: `set-${counter}`,
    load_kg: null,
    load_scope: "total",
    load_unit: "kg",
    load_value: null,
    notes: null,
    original_text: "",
    reps: 5,
    rest_seconds: null,
    rir: null,
    rpe: null,
    set_index: counter,
    set_type: "working",
    side: null,
    tempo: null,
    updated_at: "2026-07-28T00:00:00Z",
    user_id: "user-1",
    ...overrides,
  };
}

describe("groupSetsByExercise", () => {
  it("collects the sets of one exercise into a single group", () => {
    const groups = groupSetsByExercise([
      set({ exercise_id: "squat", set_index: 1 }),
      set({ exercise_id: "squat", set_index: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sets.map((s) => s.set_index)).toEqual([1, 2]);
  });

  // set_index runs across the whole activity, so the workbook's order of
  // exercises is recoverable only from where each one first appears.
  it("keeps exercises in order of first appearance, not alphabetically", () => {
    const groups = groupSetsByExercise([
      set({ exercise_id: "row", exercise_raw_text: "Chest-supported row", set_index: 15 }),
      set({ exercise_id: "raise", exercise_raw_text: "Lateral raise", set_index: 4 }),
      set({ exercise_id: "row", exercise_raw_text: "Chest-supported row", set_index: 16 }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Lateral raise", "Chest-supported row"]);
    expect(groups[1]?.sets.map((s) => s.set_index)).toEqual([15, 16]);
  });

  it("groups unmatched sets by their raw text, ignoring case and spacing", () => {
    const groups = groupSetsByExercise([
      set({ exercise_id: null, exercise_raw_text: "Rogue bike" }),
      set({ exercise_id: null, exercise_raw_text: " rogue bike " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Rogue bike");
  });

  it("does not merge two exercises that happen to share raw text with different ids", () => {
    const groups = groupSetsByExercise([
      set({ exercise_id: "a", exercise_raw_text: "Press" }),
      set({ exercise_id: "b", exercise_raw_text: "Press" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("leaves the caller's array untouched", () => {
    const input = [set({ set_index: 2 }), set({ set_index: 1 })];
    const order = input.map((s) => s.id);
    groupSetsByExercise(input);
    expect(input.map((s) => s.id)).toEqual(order);
  });
});
