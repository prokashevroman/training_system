import {
  AiErrorResponseSchema,
  HealthResponseSchema,
  TranscribeResponseSchema,
} from "@training/ai-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "./app.js";
import { resetJwksCache } from "./auth.js";
import { MOCK_TRANSCRIPT } from "./providers/mock/index.js";
import { resetRateLimits } from "./rate-limit.js";
import { buildRequest, createEnv, fakeAi, signToken } from "./testing/harness.js";

/**
 * Route-level tests through the real pipeline, with the mock provider. No
 * network, no workerd: `handleRequest` is called directly with a fake env.
 */

const PATH = "/v1/transcriptions";

const validMeta = {
  mimeType: "audio/webm;codecs=opus",
  durationSeconds: 30,
};

let token: string;

beforeEach(async () => {
  resetRateLimits();
  resetJwksCache();
  token = await signToken();
});

function audioForm(
  meta: unknown = validMeta,
  bytes: Uint8Array = new Uint8Array([1, 2, 3, 4]),
): FormData {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  form.set("audio", new Blob([bytes], { type: "audio/webm" }), "clip.webm");
  return form;
}

function postAudio(form: FormData, options: { token?: string | null } = {}): Request {
  return buildRequest(PATH, {
    method: "POST",
    token: options.token === undefined ? token : options.token,
    body: form,
    // The browser must set the multipart boundary itself.
    contentType: null,
  });
}

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
    expect(body.models.stt).toBe("mock-stt-v1");
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("reports the configured Cloudflare model ID verbatim", async () => {
    const env = createEnv({
      AI_PROVIDER: "cloudflare",
      STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
      AI: fakeAi([]),
    });
    const response = await handleRequest(buildRequest("/health", { origin: null }), env);
    const body = HealthResponseSchema.parse(await response.json());
    expect(body.provider).toBe("cloudflare");
    expect(body.models.stt).toBe("@cf/openai/whisper-large-v3-turbo");
  });

  it("fails clearly when the provider is cloudflare but the model is unset", async () => {
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

describe("authentication on /v1/transcriptions", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await handleRequest(postAudio(audioForm(), { token: null }), createEnv());
    expect(response.status).toBe(401);
    expect((await readError(response)).code).toBe("unauthorized");
  });

  it("rejects a garbage token", async () => {
    const response = await handleRequest(
      postAudio(audioForm(), { token: "not.a.jwt" }),
      createEnv(),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = await signToken({ expiresInSeconds: -600 });
    const response = await handleRequest(postAudio(audioForm(), { token: expired }), createEnv());
    expect(response.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = await signToken({ secret: "an-entirely-different-32-char-secret" });
    const response = await handleRequest(postAudio(audioForm(), { token: forged }), createEnv());
    expect(response.status).toBe(401);
  });
});

describe("POST /v1/transcriptions", () => {
  it("transcribes a multipart upload through the mock provider", async () => {
    const response = await handleRequest(postAudio(audioForm()), createEnv());
    expect(response.status).toBe(200);
    const body = TranscribeResponseSchema.parse(await response.json());
    expect(body.transcript).toBe(MOCK_TRANSCRIPT);
    expect(body.transcription.provider).toBe("mock");
    expect(body.transcription.durationSeconds).toBe(30);
  });

  it("rejects a non-multipart body", async () => {
    const request = buildRequest(PATH, {
      method: "POST",
      token,
      body: JSON.stringify({ audioBase64: "AAAA", ...validMeta }),
    });
    const response = await handleRequest(request, createEnv());
    expect(response.status).toBe(422);
    expect((await readError(response)).code).toBe("schema_invalid");
  });

  it("rejects multipart with no audio part", async () => {
    const form = new FormData();
    form.set("meta", JSON.stringify(validMeta));
    const response = await handleRequest(postAudio(form), createEnv());
    expect(response.status).toBe(422);
  });

  it("rejects multipart with no meta field, naming it", async () => {
    const form = new FormData();
    form.set("audio", new Blob([new Uint8Array([1])], { type: "audio/webm" }), "clip.webm");
    const response = await handleRequest(postAudio(form), createEnv());
    expect(response.status).toBe(422);
    const body = AiErrorResponseSchema.parse(await response.json());
    expect(body.error.message).toContain("meta");
  });

  it("rejects empty audio", async () => {
    const response = await handleRequest(
      postAudio(audioForm(validMeta, new Uint8Array([]))),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects an unsupported audio format", async () => {
    const response = await handleRequest(
      postAudio(audioForm({ ...validMeta, mimeType: "video/mp4" })),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects a recording longer than the configured limit", async () => {
    const env = createEnv({ MAX_AUDIO_SECONDS: "20" });
    const response = await handleRequest(postAudio(audioForm()), env);
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("audio_too_long");
  });

  it("rejects a duration past the contract maximum at schema level", async () => {
    const response = await handleRequest(
      postAudio(audioForm({ ...validMeta, durationSeconds: 3600 })),
      createEnv(),
    );
    expect(response.status).toBe(422);
  });

  it("rejects audio larger than the configured byte limit", async () => {
    const env = createEnv({ MAX_AUDIO_BYTES: "2" });
    const response = await handleRequest(postAudio(audioForm()), env);
    expect(response.status).toBe(413);
    expect((await readError(response)).code).toBe("payload_too_large");
  });

  it("enforces the per-user rate limit", async () => {
    const env = createEnv({ RATE_LIMIT_PER_MINUTE: "1" });
    const first = await handleRequest(postAudio(audioForm()), env);
    expect(first.status).toBe(200);
    const second = await handleRequest(postAudio(audioForm()), env);
    expect(second.status).toBe(429);
    expect((await readError(second)).code).toBe("rate_limited");
  });
});

describe("unknown routes", () => {
  it("answers 404 in the shared error envelope, even for the old draft paths", async () => {
    for (const path of ["/v1/workout-drafts/from-text", "/v1/workout-drafts/from-audio", "/nope"]) {
      const response = await handleRequest(
        buildRequest(path, { method: "POST", token, body: "{}" }),
        createEnv(),
      );
      expect(response.status).toBe(404);
      expect((await readError(response)).code).toBe("not_found");
    }
  });
});
