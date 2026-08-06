import type { GeneratePlanInput, ParseWorkoutInput } from "@training/ai-contracts";
import { PlanDraftSchema, WorkoutDraftSchema } from "@training/ai-contracts";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../env.js";
import { AiHttpError } from "../../http-error.js";
import { chatResponse, createEnv, fakeAi } from "../../testing/harness.js";
import { createCloudflareProviders } from "./index.js";
import { CloudflareSpeechToText } from "./stt.js";
import { CloudflareWorkoutParser } from "./parser.js";
import { CloudflareTrainingPlanner } from "./planner.js";

/**
 * Workers AI providers driven by a fake binding. No network: every model response
 * is canned, which is how the retry-once path can be asserted exactly.
 */

const parseInput: ParseWorkoutInput = {
  text: "Back squat 3x5 at 100 kg",
  nowLocalDate: "2026-08-02",
  timezone: "Europe/Madrid",
  preferredUnits: "metric",
  source: "voice",
  exerciseAliases: [{ alias: "squats", slug: "back-squat" }],
  recentExerciseNames: ["Back squat"],
  clientRequestKey: "voice:user-1:key-1",
  requestId: "req_parser_1",
};

/** What a compliant model returns: no server-owned fields. */
const modelDraft = {
  resolvedLocalDate: "2026-08-02",
  sessions: [
    {
      localDate: "2026-08-02",
      title: "Squat session",
      activities: [
        {
          sequence: 1,
          modality: "strength",
          originalText: "Back squat 3x5 at 100 kg",
          strengthSets: [
            {
              setIndex: 1,
              exercise: { rawText: "Back squat", slug: "back-squat", confidence: 1 },
              reps: 5,
              loadValue: 100,
              loadUnit: "kg",
              loadKg: 100,
              loadScope: "total",
              originalText: "3x5 at 100 kg",
            },
          ],
        },
      ],
    },
  ],
  warnings: [],
  unconsumedFragments: [],
};

const planInput: GeneratePlanInput = {
  startLocalDate: "2026-08-03",
  timezone: "Europe/Madrid",
  weeks: 1,
  goal: "Sub-45 10k",
  preferredUnits: "metric",
  constraints: [],
  recentSessions: [],
  notes: null,
  requestId: "req_plan_1",
};

const modelPlan = {
  startLocalDate: "2026-08-03",
  endLocalDate: "2026-08-09",
  goal: "Sub-45 10k",
  sessions: [
    {
      localDate: "2026-08-05",
      title: "Threshold intervals",
      rationale: "Race-pace work.",
      activities: [
        {
          sequence: 1,
          modality: "running",
          objective: "tempo_threshold",
          intensity: "hard",
          prescription: "5 x 1 km at threshold",
        },
      ],
    },
  ],
  warnings: [],
};

describe("CloudflareWorkoutParser", () => {
  it("returns a validated draft with server-owned fields injected", async () => {
    const ai = fakeAi([chatResponse(modelDraft)]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);

    const parsed = WorkoutDraftSchema.parse(draft);
    expect(parsed.metadata.provider).toBe("cloudflare");
    expect(parsed.metadata.model).toBe("@cf/test/parser");
    expect(parsed.metadata.attempts).toBe(1);
    expect(parsed.metadata.requestId).toBe("req_parser_1");
    // The model never sets these.
    expect(parsed.sessions[0]?.source).toBe("voice");
    expect(parsed.sessions[0]?.clientRequestKey).toBe("voice:user-1:key-1:1");
    expect(parsed.sessions[0]?.transcript).toBe(parseInput.text);
    expect(ai.calls).toHaveLength(1);
  });

  it("asks for JSON output and passes the parsing contract in the prompt", async () => {
    const ai = fakeAi([chatResponse(modelDraft)]);
    await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);

    const input = ai.calls[0]?.input as {
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      temperature: number;
    };
    expect(input.response_format.type).toBe("json_object");
    expect(input.temperature).toBe(0);
    const system = input.messages[0]?.content ?? "";
    expect(system).toContain("Never invent missing data");
    expect(system).toContain("Never give a medical diagnosis");
    expect(system).toContain("hybrid_conditioning");
    const user = input.messages[1]?.content ?? "";
    expect(user).toContain("2026-08-02");
    expect(user).toContain("Europe/Madrid");
    expect(user).toContain("squats -> back-squat");
  });

  it("strips a code fence the model added anyway", async () => {
    const ai = fakeAi([chatResponse(`\`\`\`json\n${JSON.stringify(modelDraft)}\n\`\`\``)]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);
    expect(draft.metadata.attempts).toBe(1);
    expect(draft.sessions).toHaveLength(1);
  });

  it("accepts an object response as well as a JSON string", async () => {
    const ai = fakeAi([{ response: modelDraft }]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);
    expect(draft.sessions).toHaveLength(1);
  });

  it("strips a reasoning preamble without spending the repair attempt", async () => {
    const ai = fakeAi([
      chatResponse(
        `<think>The athlete said 3x5. That is three sets.</think>\n${JSON.stringify(modelDraft)}`,
      ),
    ]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);
    // The point of the assertion is the 1: a leaked think block used to cost a
    // second full model call even though the JSON beside it was already valid.
    expect(draft.metadata.attempts).toBe(1);
    expect(draft.sessions).toHaveLength(1);
  });

  it("recovers JSON wrapped in prose without spending the repair attempt", async () => {
    const ai = fakeAi([
      chatResponse(
        `Here is the draft you asked for:\n${JSON.stringify(modelDraft)}\nHope that helps!`,
      ),
    ]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);
    expect(draft.metadata.attempts).toBe(1);
    expect(draft.sessions).toHaveLength(1);
  });

  it("maps null on required enum/text fields to their unstated members, not a retry", async () => {
    // Verbatim failure mode observed live: a literal model obeys "never invent"
    // by emitting null for everything "3 sets of 10 pushups" does not state,
    // which used to burn the repair attempt and then 422.
    const nulled = {
      ...modelDraft,
      warnings: [
        { code: "PARTIAL_PARSE", message: "kept", sourceFragment: "x", severity: "info" },
        { code: "UNKNOWN_LOAD_SCOPE", message: "invented", sourceFragment: "x", severity: "info" },
      ],
      sessions: [
        {
          ...modelDraft.sessions[0],
          title: null,
          activities: [
            {
              ...modelDraft.sessions[0]!.activities[0],
              objective: null,
              intensity: null,
              strengthSets: modelDraft.sessions[0]!.activities[0]!.strengthSets.map((set) => ({
                ...set,
                setType: null,
                loadValue: null,
                loadUnit: null,
                loadKg: null,
                loadScope: null,
              })),
            },
          ],
        },
      ],
    };
    const ai = fakeAi([chatResponse(nulled)]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);
    expect(draft.metadata.attempts).toBe(1);
    expect(draft.sessions[0]?.title).toBe("Training session");
    expect(draft.sessions[0]?.activities[0]?.objective).toBe("unknown");
    expect(draft.sessions[0]?.activities[0]?.intensity).toBe("unknown");
    const set = draft.sessions[0]?.activities[0]?.strengthSets[0];
    expect(set?.setType).toBe("working");
    expect(set?.loadUnit).toBe("none");
    expect(set?.loadScope).toBe("unknown");
    // The representable warning survives; only the invented code is dropped.
    expect(draft.warnings.map((warning) => warning.code)).toEqual(["PARTIAL_PARSE"]);
  });

  it("retries once when the first response is not JSON, then succeeds", async () => {
    const ai = fakeAi([chatResponse("Sure! Here is your workout:"), chatResponse(modelDraft)]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);

    expect(draft.metadata.attempts).toBe(2);
    expect(ai.calls).toHaveLength(2);
    const repairMessage = (
      ai.calls[1]?.input as { messages: Array<{ content: string }> }
    ).messages.at(-1)?.content;
    expect(repairMessage).toContain("valid JSON");
  });

  it("retries once on a schema failure and feeds the issues back", async () => {
    // A wrong non-null enum value: normalisation heals only null/empty
    // ("unstated"), so an actual misreading must still go through repair.
    const broken = {
      ...modelDraft,
      sessions: [
        {
          ...modelDraft.sessions[0],
          activities: [{ ...modelDraft.sessions[0]!.activities[0], intensity: "medium" }],
        },
      ],
    };
    const ai = fakeAi([chatResponse(broken), chatResponse(modelDraft)]);
    const draft = await new CloudflareWorkoutParser(ai, "@cf/test/parser").parseWorkout(parseInput);

    expect(draft.metadata.attempts).toBe(2);
    const repairMessage = (
      ai.calls[1]?.input as { messages: Array<{ content: string }> }
    ).messages.at(-1)?.content;
    expect(repairMessage).toContain("sessions.0.activities.0.intensity");
  });

  it("returns schema_invalid rather than a partial guess after the retry fails", async () => {
    const broken = { resolvedLocalDate: "nope", sessions: [{ title: "" }] };
    const ai = fakeAi([chatResponse(broken), chatResponse(broken)]);
    const error = await new CloudflareWorkoutParser(ai, "@cf/test/parser")
      .parseWorkout(parseInput)
      .catch((thrown: unknown) => thrown);

    expect(ai.calls).toHaveLength(2);
    expect(error).toBeInstanceOf(AiHttpError);
    expect((error as AiHttpError).code).toBe("schema_invalid");
  });

  it("classifies a binding failure as upstream_error and does not retry", async () => {
    const ai = fakeAi([new Error("No such model: @cf/test/parser")]);
    const error = await new CloudflareWorkoutParser(ai, "@cf/test/parser")
      .parseWorkout(parseInput)
      .catch((thrown: unknown) => thrown);

    expect(ai.calls).toHaveLength(1);
    expect((error as AiHttpError).code).toBe("upstream_error");
  });

  it("classifies an unrecognised response envelope as upstream_error", async () => {
    const ai = fakeAi([{ unexpected: true }]);
    const error = await new CloudflareWorkoutParser(ai, "@cf/test/parser")
      .parseWorkout(parseInput)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("upstream_error");
  });
});

describe("CloudflareSpeechToText", () => {
  const audio = {
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    mimeType: "audio/webm",
    durationSeconds: 12,
    language: null,
  };

  it("sends base64 audio and returns the transcript with metadata", async () => {
    const ai = fakeAi([
      { text: "Squats three by five", transcription_info: { language: "en", duration: 11.5 } },
    ]);
    const result = await new CloudflareSpeechToText(ai, "@cf/test/whisper", "req_stt_1").transcribe(
      audio,
    );

    expect(result.text).toBe("Squats three by five");
    expect(result.metadata.language).toBe("en");
    expect(result.metadata.durationSeconds).toBe(11.5);
    expect(result.metadata.model).toBe("@cf/test/whisper");
    expect(typeof (ai.calls[0]?.input as { audio: unknown }).audio).toBe("string");
  });

  it("falls back to the client-reported duration and language", async () => {
    const ai = fakeAi([{ text: "Squats" }]);
    const result = await new CloudflareSpeechToText(ai, "@cf/test/whisper", "req_stt_2").transcribe(
      {
        ...audio,
        language: "es",
      },
    );
    expect(result.metadata.language).toBe("es");
    expect(result.metadata.durationSeconds).toBe(12);
  });

  it("reports an unexpected transcription shape as upstream_error", async () => {
    const ai = fakeAi([{ transcript: "wrong key" }]);
    const error = await new CloudflareSpeechToText(ai, "@cf/test/whisper", "req_stt_3")
      .transcribe(audio)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("upstream_error");
  });
});

describe("CloudflareTrainingPlanner", () => {
  it("returns a validated plan draft", async () => {
    const ai = fakeAi([chatResponse(modelPlan)]);
    const plan = await new CloudflareTrainingPlanner(ai, "@cf/test/planner").generatePlan(
      planInput,
    );
    const parsed = PlanDraftSchema.parse(plan);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.safetyFlags).toEqual([]);
    expect(parsed.metadata.promptVersion).toBe("planner/1");
  });

  it("overrides a hard session the model proposed despite reported symptoms", async () => {
    const ai = fakeAi([chatResponse(modelPlan)]);
    const plan = await new CloudflareTrainingPlanner(ai, "@cf/test/planner").generatePlan({
      ...planInput,
      notes: "Woke up dizzy and still feel light-headed",
    });

    expect(plan.safetyFlags.map((flag) => flag.code)).toEqual(["dizziness"]);
    expect(plan.sessions[0]?.activities[0]?.intensity).toBe("easy");
    expect(plan.sessions[0]?.activities[0]?.modality).toBe("mobility_recovery");
  });

  it("explains an adjustment through the shared schema", async () => {
    const ai = fakeAi([
      chatResponse({ summary: "Volume was reduced.", reasons: ["Two sessions missed"] }),
    ]);
    const explanation = await new CloudflareTrainingPlanner(
      ai,
      "@cf/test/planner",
    ).explainAdjustment({
      timezone: "Europe/Madrid",
      previousSummary: "5 sessions",
      proposedSummary: "3 sessions",
      signals: ["Two sessions missed"],
      notes: null,
      requestId: "req_explain_1",
    });
    expect(explanation.reasons).toEqual(["Two sessions missed"]);
    expect(explanation.metadata.promptVersion).toBe("planner-explain/1");
  });
});

describe("createCloudflareProviders", () => {
  it("refuses to run when a model variable is missing", () => {
    const env = createEnv({ AI_PROVIDER: "cloudflare", AI: fakeAi([]) });
    try {
      createCloudflareProviders(env, resolveConfig(env), "req_1");
      expect.unreachable("expected a configuration error");
    } catch (error) {
      expect((error as AiHttpError).code).toBe("upstream_error");
      expect((error as AiHttpError).message).toContain("STT_MODEL");
    }
  });

  it("refuses to run when the AI binding is absent", () => {
    const env = createEnv({
      AI_PROVIDER: "cloudflare",
      STT_MODEL: "a",
      WORKOUT_PARSER_MODEL: "b",
      PLANNER_MODEL: "c",
    });
    expect(() => createCloudflareProviders(env, resolveConfig(env), "req_1")).toThrow(/binding/);
  });

  it("passes the configured model IDs straight through", () => {
    const env = createEnv({
      AI_PROVIDER: "cloudflare",
      STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
      WORKOUT_PARSER_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
      PLANNER_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
      AI: fakeAi([]),
    });
    const providers = createCloudflareProviders(env, resolveConfig(env), "req_1");
    expect(providers.name).toBe("cloudflare");
    expect(providers.models).toEqual({
      stt: "@cf/openai/whisper-large-v3-turbo",
      workoutParser: "@cf/qwen/qwen3-30b-a3b-fp8",
      planner: "@cf/qwen/qwen3-30b-a3b-fp8",
    });
  });
});
