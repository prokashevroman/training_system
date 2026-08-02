import {
  AiErrorResponseSchema,
  FromAudioResponseSchema,
  FromTextResponseSchema,
  HealthResponseSchema,
  PlanDraftResponseSchema,
} from "@training/ai-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "./app.js";
import { resetJwksCache } from "./auth.js";
import { resetRateLimits } from "./rate-limit.js";
import {
  TEST_ORIGIN,
  buildRequest,
  createEnv,
  fakeAi,
  postJson,
  signToken,
} from "./testing/harness.js";

/**
 * Route-level tests through the real pipeline, with the mock provider. No
 * network, no workerd: `handleRequest` is called directly with a fake env.
 */

const TEXT_PATH = "/v1/workout-drafts/from-text";
const AUDIO_PATH = "/v1/workout-drafts/from-audio";

const validTextBody = {
  text: "Back squat 3 sets of 5 at 100 kg. Then ran 5 km easy in 25 minutes. Felt strong",
  timezone: "Europe/Madrid",
  localDate: "2026-08-02",
  idempotencyKey: "voice-2026-08-02-0001",
};

let token: string;

beforeEach(async () => {
  resetRateLimits();
  resetJwksCache();
  token = await signToken();
});

async function readError(response: Response): Promise<{ code: string; requestId: string }> {
  const body = AiErrorResponseSchema.parse(await response.json());
  return { code: body.error.code, requestId: body.error.requestId };
}

describe("GET /health", () => {
  it("answers without a token or an Origin", async () => {
    const response = await handleRequest(buildRequest("/health", { origin: null }), createEnv());
    expect(response.status).toBe(200);
    const body = HealthResponseSchema.parse(await response.json());
    expect(body.provider).toBe("mock");
    expect(body.models.workoutParser).toBe("mock-parser-v1");
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("reports the configured Cloudflare model IDs verbatim", async () => {
    const env = createEnv({
      AI_PROVIDER: "cloudflare",
      STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
      WORKOUT_PARSER_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
      PLANNER_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
      AI: fakeAi([]),
    });
    const response = await handleRequest(buildRequest("/health", { origin: null }), env);
    const body = HealthResponseSchema.parse(await response.json());
    expect(body.provider).toBe("cloudflare");
    expect(body.models.stt).toBe("@cf/openai/whisper-large-v3-turbo");
  });

  it("fails clearly when the provider is cloudflare but a model is unset", async () => {
    const env = createEnv({ AI_PROVIDER: "cloudflare", AI: fakeAi([]) });
    const response = await handleRequest(buildRequest("/health", { origin: null }), env);
    expect(response.status).toBe(502);
    expect((await readError(response)).code).toBe("upstream_error");
  });

  it("rejects a non-GET method", async () => {
    const response = await handleRequest(
      buildRequest("/health", { origin: null, method: "POST" }),
      createEnv(),
    );
    expect(response.status).toBe(404);
  });
});

describe("authentication on /v1 routes", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await handleRequest(postJson(TEXT_PATH, validTextBody), createEnv());
    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("unauthorized");
  });

  it("rejects a garbage token", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token: "not.a.jwt" }),
      createEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = await signToken({ expiresInSeconds: -600 });
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token: expired }),
      createEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = await signToken({ secret: "an-entirely-different-32-char-secret" });
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token: forged }),
      createEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("returns the CORS header on a 401 so the browser can read the error", async () => {
    const response = await handleRequest(postJson(TEXT_PATH, validTextBody), createEnv());
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
  });
});

describe("CORS enforcement", () => {
  it("rejects a disallowed origin before authentication", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token, origin: "https://evil.example" }),
      createEnv(),
    );
    expect(response.status).toBe(403);
    expect((await readError(response)).code).toBe("forbidden_origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a /v1 request with no Origin header", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token, origin: null }),
      createEnv(),
    );
    expect(response.status).toBe(403);
  });

  it("answers a preflight with 204", async () => {
    const response = await handleRequest(
      buildRequest(TEXT_PATH, { method: "OPTIONS" }),
      createEnv(),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
  });

  it("refuses a preflight from a disallowed origin", async () => {
    const response = await handleRequest(
      buildRequest(TEXT_PATH, { method: "OPTIONS", origin: "https://evil.example" }),
      createEnv(),
    );
    expect(response.status).toBe(403);
  });
});

describe("POST /v1/workout-drafts/from-text", () => {
  it("returns a schema-valid draft through the mock provider", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token }),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const draft = FromTextResponseSchema.parse(await response.json());

    expect(draft.resolvedLocalDate).toBe("2026-08-02");
    expect(draft.sessions).toHaveLength(1);
    const session = draft.sessions[0];
    expect(session?.source).toBe("manual");
    expect(session?.activities.map((activity) => activity.modality)).toEqual([
      "strength",
      "running",
    ]);
    const set = session?.activities[0]?.strengthSets[0];
    expect(set?.reps).toBe(5);
    expect(set?.loadKg).toBe(100);
    // Unresolved rather than guessed.
    expect(set?.exercise.slug).toBeNull();
    // "Felt strong" carries no metric and must be reported, not dropped.
    expect(draft.unconsumedFragments.map((fragment) => fragment.text)).toContain("Felt strong");
    expect(draft.metadata.provider).toBe("mock");
    expect(draft.metadata.attempts).toBe(1);
  });

  it("derives clientRequestKey from the token subject, not the body", async () => {
    const response = await handleRequest(
      postJson(
        TEXT_PATH,
        { ...validTextBody, userId: "00000000-0000-4000-8000-999999999999" },
        { token },
      ),
      createEnv(),
    );
    const draft = FromTextResponseSchema.parse(await response.json());
    expect(draft.sessions[0]?.clientRequestKey).toBe(
      "text:11111111-2222-4333-8444-555555555555:voice-2026-08-02-0001:1",
    );
  });

  it("is deterministic: the same request yields the same draft", async () => {
    const first = await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), createEnv());
    const second = await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), createEnv());
    const strip = (draft: unknown): unknown => {
      const value = draft as Record<string, unknown>;
      const { metadata: _metadata, ...rest } = value;
      return rest;
    };
    expect(strip(await first.json())).toEqual(strip(await second.json()));
  });

  it("warns instead of converting a load with no unit", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, { ...validTextBody, text: "Deadlift 4x8 at 165" }, { token }),
      createEnv(),
    );
    const draft = FromTextResponseSchema.parse(await response.json());
    expect(draft.warnings.map((warning) => warning.code)).toContain("UNKNOWN_LOAD_UNIT");
    expect(draft.sessions[0]?.activities[0]?.strengthSets[0]?.loadKg).toBeNull();
  });

  it("resolves today in the athlete's timezone when no date is sent", async () => {
    const { localDate: _localDate, ...withoutDate } = validTextBody;
    const response = await handleRequest(postJson(TEXT_PATH, withoutDate, { token }), createEnv());
    const draft = FromTextResponseSchema.parse(await response.json());
    expect(draft.resolvedLocalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects an unknown timezone", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, { ...validTextBody, timezone: "Mars/Olympus" }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
    expect((await readError(response)).code).toBe("schema_invalid");
  });

  it("rejects a body that is not valid JSON", async () => {
    const request = buildRequest(TEXT_PATH, { method: "POST", token, body: "{not json" });
    const response = await handleRequest(request, createEnv());
    expect(response.status).toBe(422);
  });

  it("rejects a body missing required fields, naming the failing paths", async () => {
    const response = await handleRequest(
      postJson(TEXT_PATH, { text: "squats" }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
    const body = AiErrorResponseSchema.parse(await response.json());
    expect(JSON.stringify(body.error.details)).toContain("timezone");
  });

  it("rejects a payload over the configured byte limit with payload_too_large", async () => {
    const env = createEnv({ MAX_JSON_BODY_BYTES: "512" });
    const response = await handleRequest(
      postJson(TEXT_PATH, { ...validTextBody, text: "squats ".repeat(200) }, { token }),
      env,
    );
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("payload_too_large");
  });

  it("rejects text over the configured character limit", async () => {
    const env = createEnv({ MAX_TEXT_CHARS: "20" });
    const response = await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), env);
    expect(response.status).toBe(413);
  });
});

describe("POST /v1/workout-drafts/from-audio", () => {
  const audioMeta = {
    timezone: "Europe/Madrid",
    localDate: "2026-08-02",
    idempotencyKey: "voice-2026-08-02-0002",
    mimeType: "audio/webm;codecs=opus",
    durationSeconds: 30,
  };
  const audioBase64 = btoa("fake-opus-bytes");

  it("transcribes and parses through the mock providers", async () => {
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, audioBase64 }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const draft = FromAudioResponseSchema.parse(await response.json());
    expect(draft.transcript.length).toBeGreaterThan(0);
    expect(draft.sessions[0]?.source).toBe("voice");
    expect(draft.sessions[0]?.transcript).toBe(draft.transcript);
    expect(draft.transcription.durationSeconds).toBe(30);
    expect(draft.sessions[0]?.clientRequestKey).toContain("voice:");
  });

  it("accepts a multipart upload", async () => {
    const form = new FormData();
    form.set("meta", JSON.stringify(audioMeta));
    form.set(
      "audio",
      new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }),
      "clip.webm",
    );
    const request = buildRequest(AUDIO_PATH, {
      method: "POST",
      token,
      body: form,
      contentType: null,
    });
    const response = await handleRequest(request, createEnv());
    expect(response.status).toBe(200);
    FromAudioResponseSchema.parse(await response.json());
  });

  it("rejects a recording longer than the configured limit", async () => {
    const env = createEnv({ MAX_AUDIO_SECONDS: "20" });
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, audioBase64 }, { token }),
      env,
    );
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("audio_too_long");
  });

  it("rejects a duration past the contract maximum at schema level", async () => {
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, durationSeconds: 3600, audioBase64 }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects audio larger than the configured byte limit", async () => {
    const env = createEnv({ MAX_AUDIO_BYTES: "16" });
    const big = btoa("x".repeat(64));
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, audioBase64: big }, { token }),
      env,
    );
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("payload_too_large");
  });

  it("rejects an unsupported audio format", async () => {
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, mimeType: "video/mp4", audioBase64 }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects an empty audio payload", async () => {
    const response = await handleRequest(
      postJson(AUDIO_PATH, { ...audioMeta, audioBase64: btoa("") }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects multipart with no audio part", async () => {
    const form = new FormData();
    form.set("meta", JSON.stringify(audioMeta));
    const request = buildRequest(AUDIO_PATH, {
      method: "POST",
      token,
      body: form,
      contentType: null,
    });
    const response = await handleRequest(request, createEnv());
    expect(response.status).toBe(422);
  });
});

describe("POST /v1/plans/draft", () => {
  const planBody = {
    timezone: "Europe/Madrid",
    startLocalDate: "2026-08-03",
    weeks: 2,
    goal: "Sub-45 10k while keeping the squat",
  };

  it("returns a schema-valid plan draft", async () => {
    const response = await handleRequest(
      postJson("/v1/plans/draft", planBody, { token }),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const plan = PlanDraftResponseSchema.parse(await response.json());
    expect(plan.sessions).toHaveLength(6);
    expect(plan.startLocalDate).toBe("2026-08-03");
    expect(plan.endLocalDate).toBe("2026-08-16");
    expect(plan.safetyFlags).toEqual([]);
  });

  it("withholds hard sessions when the notes report chest pain", async () => {
    const response = await handleRequest(
      postJson(
        "/v1/plans/draft",
        { ...planBody, notes: "Had some chest pain on the last run" },
        { token },
      ),
      createEnv(),
    );
    const plan = PlanDraftResponseSchema.parse(await response.json());
    expect(plan.safetyFlags.map((flag) => flag.code)).toEqual(["chest_pain"]);
    const intensities = plan.sessions.flatMap((session) =>
      session.activities.map((activity) => activity.intensity),
    );
    expect(intensities).not.toContain("hard");
    expect(intensities).not.toContain("max");
    expect(JSON.stringify(plan)).not.toMatch(/diagnos/i);
  });

  it("rejects a horizon past the maximum", async () => {
    const response = await handleRequest(
      postJson("/v1/plans/draft", { ...planBody, weeks: 99 }, { token }),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("explains an adjustment", async () => {
    const response = await handleRequest(
      postJson(
        "/v1/plans/explain",
        {
          timezone: "Europe/Madrid",
          previousSummary: "5 sessions, 2 hard",
          proposedSummary: "4 sessions, 1 hard",
          signals: ["Missed Tuesday", "RPE 9 on Thursday"],
        },
        { token },
      ),
      createEnv(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reasons: string[] };
    expect(body.reasons).toHaveLength(2);
  });
});

describe("rate limiting and unknown routes", () => {
  it("returns 429 once the per-user limit is exceeded", async () => {
    const env = createEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    const first = await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), env);
    expect(first.status).toBe(200);
    const second = await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), env);
    expect(second.status).toBe(429);
    const error = AiErrorResponseSchema.parse(await second.json());
    expect(error.error.code).toBe("rate_limited");
    expect(error.error.details).toMatchObject({ limitPerMinute: 1 });
  });

  it("answers an unknown route in the standard envelope", async () => {
    const response = await handleRequest(postJson("/v1/nope", {}, { token }), createEnv());
    expect(response.status).toBe(404);
    expect((await readError(response)).code).toBe("not_found");
  });

  it("echoes a caller-supplied request id and rejects an unsafe one", async () => {
    const good = await handleRequest(
      postJson(TEXT_PATH, validTextBody, { token, headers: { "x-request-id": "req-abc-12345" } }),
      createEnv(),
    );
    expect(good.headers.get("x-request-id")).toBe("req-abc-12345");

    const bad = await handleRequest(
      postJson(TEXT_PATH, validTextBody, {
        token,
        headers: { "x-request-id": "<script>alert(1)</script>" },
      }),
      createEnv(),
    );
    expect(bad.headers.get("x-request-id")).not.toContain("script");
  });
});

describe("logging hygiene", () => {
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never logs the bearer token, the transcript or the audio", async () => {
    const audioBase64 = btoa("fake-opus-bytes");
    await handleRequest(
      postJson(
        AUDIO_PATH,
        {
          timezone: "Europe/Madrid",
          idempotencyKey: "voice-2026-08-02-0003",
          mimeType: "audio/webm",
          durationSeconds: 12,
          audioBase64,
        },
        { token },
      ),
      createEnv(),
    );

    expect(logs.length).toBeGreaterThan(0);
    const combined = logs.join("\n");
    expect(combined).not.toContain(token);
    expect(combined).not.toContain(audioBase64);
    expect(combined).not.toContain("Back squat");
    // Sizes are logged instead of content.
    expect(combined).toMatch(/"transcriptChars":\d+/);
  });

  it("logs no source text on the from-text route", async () => {
    await handleRequest(postJson(TEXT_PATH, validTextBody, { token }), createEnv());
    const combined = logs.join("\n");
    expect(combined).not.toContain(validTextBody.text);
    expect(combined).toMatch(/"inputChars":\d+/);
  });
});
