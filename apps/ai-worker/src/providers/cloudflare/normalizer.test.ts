import { describe, expect, it } from "vitest";
import { AiHttpError } from "../../http-error.js";
import { fakeAi } from "../../testing/harness.js";
import { CloudflareTextNormalizer } from "./normalizer.js";

/**
 * The Workers AI normalizer driven by a fake binding. No network: every model
 * response is canned. What matters here is the contract, not the prose: valid
 * JSON passes through, garbage buys exactly one repair, and the binding's own
 * failures are never retried.
 */

const INPUT = {
  text: "31.08 did the rear delt flies three sets of twelve at 7.5 each arm",
  todayLocalDate: "2026-09-06",
};

const GOOD = {
  date: "2026-08-31",
  lines: ["Single-arm cable rear-delt fly 3 sets x12 reps each arm (7.5kg)"],
};

describe("CloudflareTextNormalizer", () => {
  it("returns the rewrite with provenance metadata", async () => {
    const ai = fakeAi([{ response: JSON.stringify(GOOD) }]);
    const result = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n1").normalize(
      INPUT,
    );

    expect(result.notation).toBe(GOOD.lines[0]);
    expect(result.localDate).toBe("2026-08-31");
    expect(result.metadata).toMatchObject({
      provider: "cloudflare",
      model: "@cf/test/chat",
      attempts: 1,
      requestId: "req_n1",
    });

    const call = ai.calls[0]!;
    expect(call.model).toBe("@cf/test/chat");
    // The athlete's text and today's date both reach the model.
    const messages = call.input.messages as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.content.includes(INPUT.text))).toBe(true);
    expect(messages.some((m) => m.content.includes("2026-09-06"))).toBe(true);
  });

  it("accepts an object response and a fenced string alike", async () => {
    for (const canned of [
      { response: GOOD },
      { response: "```json\n" + JSON.stringify(GOOD) + "\n```" },
      { result: { response: JSON.stringify(GOOD) } },
    ]) {
      const ai = fakeAi([canned]);
      const result = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n2").normalize(
        INPUT,
      );
      expect(result.notation).toBe(GOOD.lines[0]);
    }
  });

  it("repairs once after invalid JSON, feeding the failure back", async () => {
    const ai = fakeAi([
      { response: "here you go: not json at all" },
      { response: JSON.stringify(GOOD) },
    ]);
    const result = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n3").normalize(
      INPUT,
    );
    expect(result.notation).toBe(GOOD.lines[0]);
    expect(result.metadata.attempts).toBe(2);
    const secondMessages = ai.calls[1]!.input.messages as Array<{ content: string }>;
    expect(secondMessages[secondMessages.length - 1]!.content).toContain("not valid JSON");
  });

  it("fails with schema_invalid after the single repair attempt", async () => {
    const ai = fakeAi([
      { response: JSON.stringify({ date: "31.08.2026", lines: [] }) },
      { response: JSON.stringify({ wrong: true }) },
    ]);
    const error = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n4")
      .normalize(INPUT)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("schema_invalid");
    expect(ai.calls).toHaveLength(2);
  });

  it("rejects a structurally valid but blank rewrite", async () => {
    const ai = fakeAi([{ response: JSON.stringify({ date: null, lines: ["  ", ""] }) }]);
    const error = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n5")
      .normalize(INPUT)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("schema_invalid");
  });

  it("does not retry a binding failure", async () => {
    const ai = fakeAi([new Error("model is deprecated")]);
    const error = await new CloudflareTextNormalizer(ai, "@cf/test/chat", "req_n6")
      .normalize(INPUT)
      .catch((thrown: unknown) => thrown);
    expect((error as AiHttpError).code).toBe("upstream_error");
    expect(ai.calls).toHaveLength(1);
  });
});
