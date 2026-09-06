import type { NormalizeResponse } from "@training/ai-contracts";
import { NormalizeRequestSchema, NormalizeResponseSchema } from "@training/ai-contracts";
import { readJson, validate } from "../body.js";
import { AiHttpError } from "../http-error.js";
import { textSize } from "../log.js";
import type { RequestContext } from "./context.js";

/**
 * `POST /v1/normalizations`.
 *
 * Rewrite chaotic entry text into parser notation and return it — nothing else.
 * The text exists only for the duration of this call: it is never written
 * anywhere and never logged; sizes are logged, content is not (brief 7.1,
 * section 12).
 *
 * The Worker deliberately does not return structured training data. The browser
 * runs the shared deterministic parser over the notation, shows warnings and
 * unconsumed lines, and saves through the athlete's own RLS-protected rows —
 * the model cannot put a number in the database that the parser did not read.
 */
export async function handleNormalize(context: RequestContext): Promise<NormalizeResponse> {
  const { config, providers, logger, user } = context;
  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AiHttpError("schema_invalid", "Send the text as application/json.");
  }

  const body = await readJson(
    context.request,
    NormalizeRequestSchema,
    config.limits.maxJsonBodyBytes,
    "Request body",
  );

  // The schema caps text at the shared default; an environment may lower it.
  if (body.text.length > config.limits.maxTextChars) {
    throw new AiHttpError("payload_too_large", "Text is longer than the configured limit.", {
      maxTextChars: config.limits.maxTextChars,
      actualChars: body.text.length,
    });
  }

  const rewrite = await providers.textNormalizer.normalize({
    text: body.text,
    todayLocalDate: body.todayLocalDate,
  });

  const response = validate(
    NormalizeResponseSchema,
    { notation: rewrite.notation, localDate: rewrite.localDate, normalization: rewrite.metadata },
    "Normalization response",
  );

  logger.info("normalization_completed", {
    userId: user.userId,
    provider: providers.name,
    // Sizes only. The entry text and the rewrite are never logged.
    inputChars: textSize(body.text),
    notationChars: textSize(response.notation),
    dateResolved: response.localDate !== null,
    attempts: response.normalization.attempts,
    latencyMs: response.normalization.latencyMs,
  });

  return response;
}
