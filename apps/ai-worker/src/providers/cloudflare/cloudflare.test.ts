import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../env.js";
import { AiHttpError } from "../../http-error.js";
import { createEnv, fakeAi } from "../../testing/harness.js";
import { createCloudflareProviders } from "./index.js";
import { CloudflareSpeechToText } from "./stt.js";

/**
 * The Workers AI transcriber driven by a fake binding. No network: every model
 * response is canned.
 */

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

  it("reports a binding failure as upstream_error with the model named", async () => {
    const ai = fakeAi([new Error("No such model")]);
    const error = await new CloudflareSpeechToText(ai, "@cf/test/whisper", "req_stt_4")
      .transcribe(audio)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("upstream_error");
    expect((error as AiHttpError).details).toMatchObject({ model: "@cf/test/whisper" });
  });
});

describe("createCloudflareProviders", () => {
  it("refuses to run when the model variable is missing", () => {
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
    });
    expect(() => createCloudflareProviders(env, resolveConfig(env), "req_1")).toThrow(/binding/);
  });

  it("passes the configured model ID straight through", () => {
    const env = createEnv({
      AI_PROVIDER: "cloudflare",
      STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
      AI: fakeAi([]),
    });
    const providers = createCloudflareProviders(env, resolveConfig(env), "req_1");
    expect(providers.name).toBe("cloudflare");
    expect(providers.models).toEqual({
      stt: "@cf/openai/whisper-large-v3-turbo",
    });
  });
});
