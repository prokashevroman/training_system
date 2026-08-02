import { describe, expect, it } from "vitest";
import {
  FromAudioJsonRequestSchema,
  FromAudioMetaSchema,
  FromAudioResponseSchema,
  FromTextRequestSchema,
  FromTextResponseSchema,
  HealthResponseSchema,
  PlanDraftRequestSchema,
  PlanExplainRequestSchema,
} from "./api.js";
import { exampleWorkoutDraft } from "./fixtures.js";
import { AI_LIMITS } from "./limits.js";

const validText = {
  text: "Squats 3 sets of 5 at 100 kilos",
  timezone: "Europe/Madrid",
  idempotencyKey: "voice-2026-08-02-001",
};

describe("FromTextRequestSchema", () => {
  it("round-trips a minimal request and applies defaults", () => {
    const parsed = FromTextRequestSchema.parse(validText);
    expect(parsed.preferredUnits).toBe("metric");
    expect(parsed.localDate).toBeNull();
    expect(parsed.context).toEqual({ exerciseAliases: [], recentExerciseNames: [] });
  });

  it("round-trips a fully specified request unchanged", () => {
    const full = {
      ...validText,
      localDate: "2026-08-02",
      preferredUnits: "imperial" as const,
      context: {
        exerciseAliases: [{ alias: "squats", slug: "back-squat" }],
        recentExerciseNames: ["Back squat"],
      },
    };
    expect(FromTextRequestSchema.parse(full)).toEqual(full);
  });

  it("rejects empty text", () => {
    expect(() => FromTextRequestSchema.parse({ ...validText, text: "" })).toThrow();
  });

  it("rejects text past the character limit", () => {
    const text = "a".repeat(AI_LIMITS.maxTextChars + 1);
    expect(() => FromTextRequestSchema.parse({ ...validText, text })).toThrow();
  });

  it("rejects a bogus timezone shape", () => {
    expect(() => FromTextRequestSchema.parse({ ...validText, timezone: "not a zone!" })).toThrow();
  });

  it("rejects a malformed localDate", () => {
    expect(() => FromTextRequestSchema.parse({ ...validText, localDate: "02-08-2026" })).toThrow();
  });

  it("rejects a short idempotency key", () => {
    expect(() => FromTextRequestSchema.parse({ ...validText, idempotencyKey: "abc" })).toThrow();
  });

  it("ignores a userId smuggled into the body", () => {
    const parsed = FromTextRequestSchema.parse({ ...validText, userId: "someone-else" });
    expect(parsed).not.toHaveProperty("userId");
  });

  it("rejects too many alias hints", () => {
    const exerciseAliases = Array.from({ length: AI_LIMITS.maxAliasHints + 1 }, (_, i) => ({
      alias: `a${i}`,
      slug: `s${i}`,
    }));
    expect(() =>
      FromTextRequestSchema.parse({ ...validText, context: { exerciseAliases } }),
    ).toThrow();
  });
});

describe("FromAudioMetaSchema", () => {
  const validMeta = {
    timezone: "Europe/Madrid",
    idempotencyKey: "voice-2026-08-02-002",
    mimeType: "audio/webm;codecs=opus",
    durationSeconds: 42,
  };

  it("round-trips valid metadata", () => {
    const parsed = FromAudioMetaSchema.parse(validMeta);
    expect(parsed.language).toBeNull();
    expect(parsed.durationSeconds).toBe(42);
  });

  it("rejects a duration past the recording limit", () => {
    expect(() =>
      FromAudioMetaSchema.parse({
        ...validMeta,
        durationSeconds: AI_LIMITS.maxAudioDurationSeconds + 1,
      }),
    ).toThrow();
  });

  it("rejects a zero duration", () => {
    expect(() => FromAudioMetaSchema.parse({ ...validMeta, durationSeconds: 0 })).toThrow();
  });

  it("requires audioBase64 in the JSON variant", () => {
    expect(() => FromAudioJsonRequestSchema.parse(validMeta)).toThrow();
    expect(() =>
      FromAudioJsonRequestSchema.parse({ ...validMeta, audioBase64: "AAAA" }),
    ).not.toThrow();
  });
});

describe("PlanDraftRequestSchema", () => {
  const validPlan = { timezone: "Europe/Madrid", goal: "Run a sub-45 10k" };

  it("round-trips and defaults to a single week", () => {
    const parsed = PlanDraftRequestSchema.parse(validPlan);
    expect(parsed.weeks).toBe(1);
    expect(parsed.recentSessions).toEqual([]);
    expect(parsed.notes).toBeNull();
  });

  it("accepts planner context", () => {
    const parsed = PlanDraftRequestSchema.parse({
      ...validPlan,
      weeks: 4,
      constraints: ["Only mornings", "No gym on Sunday"],
      recentSessions: [{ localDate: "2026-08-01", title: "Long run", sessionRpe: 7 }],
    });
    expect(parsed.recentSessions[0]?.modalities).toEqual([]);
    expect(parsed.recentSessions[0]?.durationSeconds).toBeNull();
  });

  it("rejects a horizon past the maximum", () => {
    expect(() =>
      PlanDraftRequestSchema.parse({ ...validPlan, weeks: AI_LIMITS.maxPlanWeeks + 1 }),
    ).toThrow();
  });

  it("rejects a fractional week count", () => {
    expect(() => PlanDraftRequestSchema.parse({ ...validPlan, weeks: 1.5 })).toThrow();
  });

  it("rejects an empty goal", () => {
    expect(() => PlanDraftRequestSchema.parse({ ...validPlan, goal: "" })).toThrow();
  });

  it("rejects an out-of-range session RPE in context", () => {
    expect(() =>
      PlanDraftRequestSchema.parse({
        ...validPlan,
        recentSessions: [{ localDate: "2026-08-01", title: "Long run", sessionRpe: 12 }],
      }),
    ).toThrow();
  });
});

describe("PlanExplainRequestSchema", () => {
  it("round-trips a valid request", () => {
    const parsed = PlanExplainRequestSchema.parse({
      timezone: "Europe/Madrid",
      previousSummary: "5 sessions, 2 hard",
      proposedSummary: "4 sessions, 1 hard",
      signals: ["Missed Tuesday"],
    });
    expect(parsed.signals).toHaveLength(1);
  });

  it("rejects a missing proposedSummary", () => {
    expect(() =>
      PlanExplainRequestSchema.parse({ timezone: "UTC", previousSummary: "a" }),
    ).toThrow();
  });
});

describe("response schemas", () => {
  it("from-text response equals the workout draft contract", () => {
    const draft = exampleWorkoutDraft();
    expect(FromTextResponseSchema.parse(draft)).toEqual(draft);
  });

  it("from-audio response requires transcript and transcription metadata", () => {
    const draft = exampleWorkoutDraft();
    expect(() => FromAudioResponseSchema.parse(draft)).toThrow();
    const withTranscript = {
      ...draft,
      transcript: "Squats 3 sets of 5 at 100 kilos",
      transcription: { ...draft.metadata, language: "en", durationSeconds: 12 },
    };
    expect(() => FromAudioResponseSchema.parse(withTranscript)).not.toThrow();
  });

  it("health response round-trips and rejects a wrong status literal", () => {
    const body = {
      status: "ok" as const,
      service: "ai-worker" as const,
      provider: "mock",
      models: { stt: "mock-stt-v1", workoutParser: "mock-parser-v1", planner: "mock-planner-v1" },
      requestId: "req_1",
    };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
    expect(() => HealthResponseSchema.parse({ ...body, status: "degraded" })).toThrow();
  });
});
