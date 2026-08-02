// @vitest-environment node
// Pure request-shape assertions; nothing here needs a DOM, and `@training/domain`
// resolves a file URL at import time that jsdom's http-based `import.meta.url`
// cannot satisfy.
import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY_FILTERS,
  applyHistoryOps,
  buildHistoryRequest,
  countActiveFilters,
  monthBounds,
  type HistoryFilters,
} from "./history-queries.js";

const BASE = "*, activities(*)";

function filters(overrides: Partial<HistoryFilters>): HistoryFilters {
  return { ...EMPTY_HISTORY_FILTERS, ...overrides };
}

describe("buildHistoryRequest", () => {
  it("asks for no joins when nothing is filtered", () => {
    const request = buildHistoryRequest(EMPTY_HISTORY_FILTERS, BASE);
    expect(request.select).toBe(BASE);
    expect(request.ops).toEqual([]);
  });

  it("bounds local_date inclusively on both sides", () => {
    const request = buildHistoryRequest(filters({ from: "2026-04-01", to: "2026-04-30" }), BASE);
    expect(request.ops).toEqual([
      { kind: "gte", column: "local_date", value: "2026-04-01" },
      { kind: "lte", column: "local_date", value: "2026-04-30" },
    ]);
  });

  it("sends a multi-select as one `in` predicate", () => {
    const request = buildHistoryRequest(filters({ modalities: ["cycling", "running"] }), BASE);
    expect(request.ops).toContainEqual({
      kind: "in",
      column: "f_act.modality",
      values: ["cycling", "running"],
    });
  });

  // The join is aliased so the rendered `activities(*)` embed stays complete:
  // a modality filter must not silently hide the session's other activities.
  it("filters through an aliased inner join, leaving the display embed intact", () => {
    const request = buildHistoryRequest(filters({ modalities: ["strength"] }), BASE);
    expect(request.select).toBe("*, activities(*), f_act:activities!inner(id)");
  });

  it("shares one activity join between modality, objective and intensity", () => {
    const request = buildHistoryRequest(
      filters({ modalities: ["running"], objectives: ["vo2max"], intensities: ["hard"] }),
      BASE,
    );
    expect(request.select).toBe("*, activities(*), f_act:activities!inner(id)");
    expect(request.ops).toHaveLength(3);
  });

  it("reaches exercises through strength_sets", () => {
    const request = buildHistoryRequest(filters({ exerciseId: "ex-1" }), BASE);
    expect(request.select).toBe("*, activities(*), f_ex:activities!inner(strength_sets!inner(id))");
    expect(request.ops).toEqual([
      { kind: "eq", column: "f_ex.strength_sets.exercise_id", value: "ex-1" },
    ]);
  });

  it("reaches movement pattern through the exercise library", () => {
    const request = buildHistoryRequest(filters({ movementPattern: "squat" }), BASE);
    expect(request.select).toBe(
      "*, activities(*), f_mp:activities!inner(strength_sets!inner(exercises!inner(id)))",
    );
    expect(request.ops).toEqual([
      { kind: "eq", column: "f_mp.strength_sets.exercises.movement_pattern", value: "squat" },
    ]);
  });

  it("treats `any` benchmark as the join alone, with no slug predicate", () => {
    const request = buildHistoryRequest(filters({ benchmark: "any" }), BASE);
    expect(request.select).toBe(
      "*, activities(*), f_bench:activities!inner(benchmark_results!inner(id))",
    );
    expect(request.ops).toEqual([]);
  });

  it("narrows a benchmark to one definition slug", () => {
    const request = buildHistoryRequest(filters({ benchmark: "murph" }), BASE);
    expect(request.ops).toEqual([
      { kind: "eq", column: "f_bench.benchmark_results.definition_slug", value: "murph" },
    ]);
  });

  it("maps planned/unplanned onto the planned_session_id link", () => {
    expect(buildHistoryRequest(filters({ planned: "planned" }), BASE).ops).toEqual([
      { kind: "isNotNull", column: "planned_session_id" },
    ]);
    expect(buildHistoryRequest(filters({ planned: "unplanned" }), BASE).ops).toEqual([
      { kind: "isNull", column: "planned_session_id" },
    ]);
  });

  it("combines every join in one request", () => {
    const request = buildHistoryRequest(
      filters({
        from: "2026-01-01",
        modalities: ["strength"],
        exerciseId: "ex-1",
        movementPattern: "hinge",
        benchmark: "cindy",
        sources: ["excel_import"],
      }),
      BASE,
    );
    expect(request.select).toBe(
      "*, activities(*), f_act:activities!inner(id), f_ex:activities!inner(strength_sets!inner(id)), " +
        "f_mp:activities!inner(strength_sets!inner(exercises!inner(id))), " +
        "f_bench:activities!inner(benchmark_results!inner(id))",
    );
    expect(request.ops).toHaveLength(6);
  });
});

describe("applyHistoryOps", () => {
  it("calls the builder once per op, in order", () => {
    const calls: string[] = [];
    const builder = {
      eq(column: string, value: unknown) {
        calls.push(`eq ${column}=${String(value)}`);
        return this;
      },
      in(column: string, values: readonly unknown[]) {
        calls.push(`in ${column}=${values.join("|")}`);
        return this;
      },
      gte(column: string, value: unknown) {
        calls.push(`gte ${column}=${String(value)}`);
        return this;
      },
      lte(column: string, value: unknown) {
        calls.push(`lte ${column}=${String(value)}`);
        return this;
      },
      is(column: string, value: null) {
        calls.push(`is ${column}=${String(value)}`);
        return this;
      },
      not(column: string, operator: string, value: unknown) {
        calls.push(`not ${column} ${operator} ${String(value)}`);
        return this;
      },
    };

    const { ops } = buildHistoryRequest(
      filters({ from: "2026-01-01", modalities: ["cycling"], planned: "unplanned" }),
      BASE,
    );
    applyHistoryOps(builder, ops);

    expect(calls).toEqual([
      "gte local_date=2026-01-01",
      "is planned_session_id=null",
      "in f_act.modality=cycling",
    ]);
  });
});

describe("monthBounds", () => {
  it("covers a 30-day month", () => {
    expect(monthBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("covers December", () => {
    expect(monthBounds("2025-12")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("gets February in a common year right", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("gets February in a leap year right", () => {
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("countActiveFilters", () => {
  it("counts nothing when unfiltered", () => {
    expect(countActiveFilters(EMPTY_HISTORY_FILTERS)).toBe(0);
  });

  it("counts each populated group once", () => {
    expect(
      countActiveFilters(filters({ from: "2026-01-01", modalities: ["cycling", "running"] })),
    ).toBe(2);
  });
});
