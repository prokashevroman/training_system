import type {
  ParseWorkoutInput,
  WorkoutDraft,
  WorkoutParserProvider,
} from "@training/ai-contracts";
import { ModelWorkoutDraftSchema } from "@training/ai-contracts";
import { buildMetadata, finaliseWorkoutDraft, normaliseModelDraft } from "../../draft.js";
import type { AiBinding } from "../../env.js";
import { dropNullsWhereDefaulted } from "../../model-nulls.js";
import { withSchemaRetry } from "../../schema-retry.js";
import { WORKOUT_PARSER_PROMPT_VERSION, parserSystemPrompt, parserUserPrompt } from "./prompts.js";
import type { ChatMessage } from "./workers-ai.js";
import { runJsonChat } from "./workers-ai.js";

const MAX_OUTPUT_TOKENS = 4096;

/**
 * Workers AI transcript/text parser.
 *
 * The model's only job is training content. Server-owned fields are injected by
 * `normaliseModelDraft`, validation happens against the shared Zod schema, and a
 * failed validation buys exactly one repair attempt before the request fails with
 * `schema_invalid` (brief 7.2 steps 7-8).
 */
export class CloudflareWorkoutParser implements WorkoutParserProvider {
  constructor(
    private readonly ai: AiBinding,
    private readonly model: string,
  ) {}

  async parseWorkout(input: ParseWorkoutInput): Promise<WorkoutDraft> {
    const startedAtMs = Date.now();
    const system = parserSystemPrompt();
    const user = parserUserPrompt(input);

    const { value, attempts } = await withSchemaRetry(
      ModelWorkoutDraftSchema,
      async ({ repairHint }) => {
        const messages: ChatMessage[] = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];
        if (repairHint !== null) {
          messages.push({ role: "user", content: repairHint });
        }
        const raw = await runJsonChat(this.ai, this.model, messages, MAX_OUTPUT_TOKENS);
        return dropNullsWhereDefaulted(ModelWorkoutDraftSchema, normaliseModelDraft(raw, input));
      },
      { requestId: input.requestId },
    );

    return finaliseWorkoutDraft(
      value,
      buildMetadata({
        provider: "cloudflare",
        model: this.model,
        promptVersion: WORKOUT_PARSER_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts,
      }),
    );
  }
}
