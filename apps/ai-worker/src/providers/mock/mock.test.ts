import type { GeneratePlanInput, ParseWorkoutInput } from "@training/ai-contracts";
import { PlanDraftSchema, WorkoutDraftSchema } from "@training/ai-contracts";
import { describe, expect, it } from "vitest";
import { normaliseModelDraft, sessionRequestKey } from "../../draft.js";
import { enforcePlanSafety } from "../../safety-rules.js";
import { createMockProviders } from "./index.js";
import { MOCK_TRANSCRIPT } from "./stt.js";

const providers = createMockProviders("req_mock_1");

function parseInput(text: string, overrides: Partial<ParseWorkoutInput> = {}): ParseWorkoutInput {
  return {
    text,
    nowLocalDate: "2026-08-02",
    timezone: "Europe/Madrid",
    preferredUnits: "metric",
    source: "voice",
    exerciseAliases: [],
    recentExerciseNames: [],
    clientRequestKey: "voice:user-1:key-1",
    requestId: "req_mock_1",
    ...overrides,
  };
}

const planInput: GeneratePlanInput = {
  startLocalDate: "2026-08-03",
  timezone: "Europe/Madrid",
  weeks: 1,
  goal: "Stay consistent",
  preferredUnits: "metric",
  constraints: [],
  recentSessions: [],
  notes: null,
  requestId: "req_mock_1",
};

describe("MockWorkoutParser", () => {
  it("produces a schema-valid draft", async () => {
    const draft = await providers.workoutParser.parseWorkout(parseInput(MOCK_TRANSCRIPT));
    expect(() => WorkoutDraftSchema.parse(draft)).not.toThrow();
    expect(draft.sessions[0]?.title).toBe("Mixed session");
  });

  it("is deterministic for the same input", async () => {
    const first = await providers.workoutParser.parseWorkout(parseInput(MOCK_TRANSCRIPT));
    const second = await providers.workoutParser.parseWorkout(parseInput(MOCK_TRANSCRIPT));
    expect({ ...first, metadata: null }).toEqual({ ...second, metadata: null });
  });

  it("converts pounds but refuses to convert a bare number", async () => {
    const pounds = await providers.workoutParser.parseWorkout(
      parseInput("Bench press 3x5 at 225 lb"),
    );
    expect(pounds.sessions[0]?.activities[0]?.strengthSets[0]?.loadKg).toBeCloseTo(102.06, 2);

    const bare = await providers.workoutParser.parseWorkout(parseInput("Bench press 3x5 at 225"));
    const set = bare.sessions[0]?.activities[0]?.strengthSets[0];
    expect(set?.loadValue).toBe(225);
    expect(set?.loadUnit).toBe("none");
    expect(set?.loadKg).toBeNull();
    expect(bare.warnings.map((warning) => warning.code)).toContain("UNKNOWN_LOAD_UNIT");
  });

  it("flags an approximate value instead of rounding it away", async () => {
    const draft = await providers.workoutParser.parseWorkout(
      parseInput("Sled push 3x10 at about 75 kg"),
    );
    expect(draft.warnings.map((warning) => warning.code)).toContain("APPROXIMATE_VALUE");
  });

  it("reports every fragment it could not use", async () => {
    const draft = await providers.workoutParser.parseWorkout(
      parseInput("Squats 3x5 at 100 kg. Shoulder felt tight. Slept badly"),
    );
    expect(draft.unconsumedFragments.map((fragment) => fragment.text)).toEqual([
      "Shoulder felt tight",
      "Slept badly",
    ]);
  });

  it("returns no sessions rather than an invented one when nothing parses", async () => {
    const draft = await providers.workoutParser.parseWorkout(parseInput("Felt tired today"));
    expect(draft.sessions).toEqual([]);
    expect(draft.unconsumedFragments).toHaveLength(1);
  });

  it("stamps the source from the request, not from the text", async () => {
    const manual = await providers.workoutParser.parseWorkout(
      parseInput("Squats 3x5 at 100 kg", { source: "manual" }),
    );
    expect(manual.sessions[0]?.source).toBe("manual");
    expect(manual.sessions[0]?.transcript).toBeNull();
  });
});

describe("MockSpeechToText", () => {
  it("returns a fixed transcript the parser can consume", async () => {
    const result = await providers.speechToText.transcribe({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
      durationSeconds: 20,
      language: null,
    });
    expect(result.text).toBe(MOCK_TRANSCRIPT);
    expect(result.metadata.provider).toBe("mock");
    expect(result.metadata.durationSeconds).toBe(20);
  });
});

describe("MockTrainingPlanner", () => {
  it("builds three sessions per requested week", async () => {
    const plan = await providers.trainingPlanner.generatePlan({ ...planInput, weeks: 3 });
    expect(() => PlanDraftSchema.parse(plan)).not.toThrow();
    expect(plan.sessions).toHaveLength(9);
    expect(plan.startLocalDate).toBe("2026-08-03");
    expect(plan.endLocalDate).toBe("2026-08-23");
    expect(plan.sessions.map((session) => session.localDate)).toContain("2026-08-17");
  });

  it("replaces hard work with recovery when notes report an injury", async () => {
    const plan = await providers.trainingPlanner.generatePlan({
      ...planInput,
      notes: "Tweaked something, sharp pain in the knee",
    });
    const intensities = plan.sessions.flatMap((session) =>
      session.activities.map((activity) => activity.intensity),
    );
    expect(intensities).not.toContain("hard");
    expect(plan.safetyFlags.length).toBeGreaterThan(0);
  });
});

describe("normaliseModelDraft", () => {
  const input = parseInput("Squats 3x5");

  it("injects server-owned fields the model must not choose", () => {
    const normalised = normaliseModelDraft(
      {
        sessions: [
          { title: "Session", activities: [] },
          { title: "Second", activities: [] },
        ],
      },
      input,
    ) as { resolvedLocalDate: string; sessions: Array<Record<string, unknown>> };

    expect(normalised.resolvedLocalDate).toBe("2026-08-02");
    expect(normalised.sessions[0]?.source).toBe("voice");
    expect(normalised.sessions[0]?.clientRequestKey).toBe("voice:user-1:key-1:1");
    expect(normalised.sessions[1]?.clientRequestKey).toBe("voice:user-1:key-1:2");
    expect(normalised.sessions[0]?.rawText).toBe("Squats 3x5");
  });

  it("overwrites a clientRequestKey the model tried to set", () => {
    const normalised = normaliseModelDraft(
      { sessions: [{ clientRequestKey: "import:sheet:1:1:1", source: "excel_import" }] },
      input,
    ) as { sessions: Array<Record<string, unknown>> };
    expect(normalised.sessions[0]?.clientRequestKey).toBe("voice:user-1:key-1:1");
    expect(normalised.sessions[0]?.source).toBe("voice");
  });

  it("survives junk in place of a draft", () => {
    expect(normaliseModelDraft(null, input)).toBeNull();
    expect(normaliseModelDraft("nope", input)).toBe("nope");
    const normalised = normaliseModelDraft({ sessions: "not an array" }, input) as {
      sessions: unknown[];
    };
    expect(normalised.sessions).toEqual([]);
  });

  it("numbers session keys from one", () => {
    expect(sessionRequestKey("voice:abc", 0)).toBe("voice:abc:1");
  });
});

describe("enforcePlanSafety", () => {
  const plan = {
    startLocalDate: "2026-08-03",
    endLocalDate: "2026-08-09",
    goal: "Goal",
    warnings: [],
    sessions: [
      {
        localDate: "2026-08-03",
        title: "Intervals",
        rationale: "Speed",
        estimatedLoad: null,
        activities: [
          {
            sequence: 1,
            modality: "running" as const,
            objective: "vo2max" as const,
            intensity: "max" as const,
            prescription: "8 x 400 m",
            targetDurationSeconds: null,
            targetDistanceKm: null,
            notes: null,
          },
        ],
      },
      {
        localDate: "2026-08-04",
        title: "Easy walk",
        rationale: "Recovery",
        estimatedLoad: null,
        activities: [
          {
            sequence: 1,
            modality: "walking_hiking" as const,
            objective: "recovery" as const,
            intensity: "easy" as const,
            prescription: "30 minutes",
            targetDurationSeconds: null,
            targetDistanceKm: null,
            notes: null,
          },
        ],
      },
    ],
  };

  it("returns the plan untouched when nothing was flagged", () => {
    expect(enforcePlanSafety(plan, [])).toBe(plan);
  });

  it("replaces only the hard session, and never diagnoses", () => {
    const flags = [
      {
        code: "chest_pain" as const,
        sourceFragment: "chest pain",
        message: "Seek professional assessment before training.",
      },
    ];
    const guarded = enforcePlanSafety(plan, flags);
    expect(guarded.sessions[0]?.title).toBe("Rest or easy recovery");
    expect(guarded.sessions[0]?.activities[0]?.intensity).toBe("easy");
    expect(guarded.sessions[0]?.rationale).toContain("assessment");
    // The already-easy session is left alone.
    expect(guarded.sessions[1]).toBe(plan.sessions[1]);
  });
});
