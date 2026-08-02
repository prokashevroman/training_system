import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiHttpError } from "./http-error.js";
import { RepairableModelError, describeIssues, withSchemaRetry } from "./schema-retry.js";

const Schema = z.object({ title: z.string().min(1), reps: z.number().int() });

describe("withSchemaRetry", () => {
  it("returns immediately when the first attempt validates", async () => {
    const run = vi.fn().mockResolvedValue({ title: "Squats", reps: 5 });
    const result = await withSchemaRetry(Schema, run);
    expect(result).toEqual({ value: { title: "Squats", reps: 5 }, attempts: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ attempt: 1, repairHint: null });
  });

  it("retries once with a repair hint naming the failing paths", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ title: "", reps: 5.5 })
      .mockResolvedValueOnce({ title: "Squats", reps: 5 });
    const result = await withSchemaRetry(Schema, run);

    expect(result.attempts).toBe(2);
    expect(run).toHaveBeenCalledTimes(2);
    const secondCall = run.mock.calls[1]?.[0] as { attempt: number; repairHint: string };
    expect(secondCall.attempt).toBe(2);
    expect(secondCall.repairHint).toContain("title:");
    expect(secondCall.repairHint).toContain("reps:");
    // The hint must not invite invention to satisfy the schema.
    expect(secondCall.repairHint).toContain("Do not invent values");
  });

  it("gives up after exactly one retry and returns schema_invalid", async () => {
    const run = vi.fn().mockResolvedValue({ title: "", reps: "many" });
    const error = await withSchemaRetry(Schema, run).catch((thrown: unknown) => thrown);

    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AiHttpError);
    const httpError = error as AiHttpError;
    expect(httpError.code).toBe("schema_invalid");
    expect(httpError.status).toBe(422);
    expect(httpError.details).toMatchObject({ attempts: 2 });
    expect(JSON.stringify(httpError.details)).toContain("title");
  });

  it("treats unparseable output as repairable and retries once", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new RepairableModelError("The previous response was not valid JSON."))
      .mockResolvedValueOnce({ title: "Squats", reps: 5 });
    const result = await withSchemaRetry(Schema, run);
    expect(result.attempts).toBe(2);
    expect((run.mock.calls[1]?.[0] as { repairHint: string }).repairHint).toContain("valid JSON");
  });

  it("propagates a non-repairable error without retrying", async () => {
    const upstream = new AiHttpError("upstream_error", "binding failed");
    const run = vi.fn().mockRejectedValue(upstream);
    await expect(withSchemaRetry(Schema, run)).rejects.toBe(upstream);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("describeIssues", () => {
  it("renders a readable path for nested and root issues", () => {
    const parsed = z
      .object({ sessions: z.array(z.object({ title: z.string() })) })
      .safeParse({ sessions: [{ title: 1 }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(describeIssues(parsed.error.issues)[0]).toMatch(/^sessions\.0\.title:/);
  });

  it("caps the number of reported issues", () => {
    const parsed = z.object({ a: z.string(), b: z.string(), c: z.string() }).safeParse({});
    if (parsed.success) return;
    expect(describeIssues(parsed.error.issues).length).toBeLessThanOrEqual(8);
  });
});
