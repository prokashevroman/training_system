import { describe, expect, it } from "vitest";
import { examplePlanDraft, examplePlanExplanation, exampleWorkoutDraft } from "./fixtures.js";
import { ModelMetadataSchema, TranscriptionMetadataSchema } from "./metadata.js";
import {
  ModelPlanDraftSchema,
  PlanDraftSchema,
  PlanExplanationSchema,
  PlannedActivitySchema,
} from "./plan-draft.js";
import { ModelWorkoutDraftSchema, WorkoutDraftSchema } from "./workout-draft.js";

describe("ModelMetadataSchema", () => {
  it("round-trips and defaults attempts to 1", () => {
    const parsed = ModelMetadataSchema.parse({
      provider: "cloudflare",
      model: "@cf/qwen/qwen3-30b-a3b-fp8",
      promptVersion: "workout-parser/1",
      requestId: "req_1",
      latencyMs: 812,
    });
    expect(parsed.attempts).toBe(1);
  });

  it("rejects a negative latency", () => {
    expect(() =>
      ModelMetadataSchema.parse({
        provider: "cloudflare",
        model: "m",
        promptVersion: "p",
        requestId: "r",
        latencyMs: -1,
      }),
    ).toThrow();
  });

  it("transcription metadata keeps language and duration nullable", () => {
    const parsed = TranscriptionMetadataSchema.parse({
      provider: "cloudflare",
      model: "@cf/openai/whisper-large-v3-turbo",
      promptVersion: "stt/1",
      requestId: "req_2",
      latencyMs: 40,
    });
    expect(parsed.language).toBeNull();
    expect(parsed.durationSeconds).toBeNull();
  });
});

describe("WorkoutDraftSchema", () => {
  it("round-trips a valid draft", () => {
    const draft = exampleWorkoutDraft();
    expect(WorkoutDraftSchema.parse(draft)).toEqual(draft);
    expect(draft.sessions[0]?.activities[0]?.strengthSets).toHaveLength(3);
  });

  it("defaults the collection fields", () => {
    const parsed = WorkoutDraftSchema.parse({
      resolvedLocalDate: "2026-08-02",
      metadata: exampleWorkoutDraft().metadata,
    });
    expect(parsed.sessions).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.unconsumedFragments).toEqual([]);
  });

  it("rejects a malformed resolvedLocalDate", () => {
    expect(() =>
      WorkoutDraftSchema.parse(exampleWorkoutDraft({ resolvedLocalDate: "2/8/26" })),
    ).toThrow();
  });

  it("rejects an unknown warning code", () => {
    const bad = {
      ...exampleWorkoutDraft(),
      warnings: [{ code: "MADE_UP", message: "x", sourceFragment: "y", severity: "info" }],
    };
    expect(() => WorkoutDraftSchema.parse(bad)).toThrow();
  });

  it("rejects an unconsumed fragment with no reason", () => {
    const bad = { ...exampleWorkoutDraft(), unconsumedFragments: [{ text: "hmm" }] };
    expect(() => WorkoutDraftSchema.parse(bad)).toThrow();
  });

  it("keeps metadata out of the model-facing schema", () => {
    expect(Object.keys(ModelWorkoutDraftSchema.shape)).not.toContain("metadata");
    const { metadata: _metadata, ...rest } = exampleWorkoutDraft();
    expect(() => ModelWorkoutDraftSchema.parse(rest)).not.toThrow();
  });
});

describe("PlanDraftSchema", () => {
  it("round-trips a valid plan", () => {
    const plan = examplePlanDraft();
    expect(PlanDraftSchema.parse(plan)).toEqual(plan);
    expect(plan.safetyFlags).toEqual([]);
  });

  it("accepts safety flags", () => {
    const plan = examplePlanDraft({
      safetyFlags: [
        { code: "chest_pain", sourceFragment: "chest pain", message: "Seek assessment." },
      ],
    });
    expect(PlanDraftSchema.parse(plan).safetyFlags).toHaveLength(1);
  });

  it("rejects a planned session with no activities", () => {
    const bad = examplePlanDraft();
    expect(() =>
      PlanDraftSchema.parse({
        ...bad,
        sessions: [{ ...bad.sessions[0], activities: [] }],
      }),
    ).toThrow();
  });

  it("rejects a planned activity with a non-positive sequence", () => {
    expect(() =>
      PlannedActivitySchema.parse({ sequence: 0, modality: "running", prescription: "run" }),
    ).toThrow();
  });

  it("keeps server-owned fields out of the model-facing schema", () => {
    const keys = Object.keys(ModelPlanDraftSchema.shape);
    expect(keys).not.toContain("metadata");
    expect(keys).not.toContain("safetyFlags");
  });
});

describe("PlanExplanationSchema", () => {
  it("round-trips a valid explanation", () => {
    const explanation = examplePlanExplanation();
    expect(PlanExplanationSchema.parse(explanation)).toEqual(explanation);
  });

  it("rejects an empty reason string", () => {
    expect(() => PlanExplanationSchema.parse(examplePlanExplanation({ reasons: [""] }))).toThrow();
  });
});
