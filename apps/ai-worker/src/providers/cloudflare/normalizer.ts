import type {
  NormalizationResult,
  NormalizeInput,
  TextNormalizerProvider,
} from "@training/ai-contracts";
import { z } from "zod";
import type { AiBinding } from "../../env.js";
import { AiHttpError } from "../../http-error.js";
import { withSchemaRetry } from "../../schema-retry.js";
import { buildMetadata } from "../metadata.js";
import type { ChatMessage } from "./workers-ai.js";
import { runJsonChat } from "./workers-ai.js";

/**
 * Workers AI notation rewriter.
 *
 * The model's only job is to rewrite chaotic entry text into the line notation
 * the deterministic workbook parser reads — text to text, transcription rather
 * than interpretation. It produces no reps, loads or enums of its own: whatever
 * it writes still has to survive `parseCell` in the browser, where every
 * ambiguity becomes a visible warning and every unreadable line is reported
 * instead of dropped. A failed validation buys exactly one repair attempt
 * before the request fails with `schema_invalid` (brief 7.2 steps 7-8).
 */

export const NORMALIZER_PROMPT_VERSION = "normalizer/1";

const MAX_OUTPUT_TOKENS = 2048;

/** What the model must return. Small on purpose: text lines and maybe a date. */
const ModelRewriteSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  lines: z.array(z.string().max(300)).min(1).max(200),
});

const RULES = [
  "Never invent a number, unit, exercise, or date the text does not state.",
  "Keep every piece of information. A detail that does not fit the notation stays in place as its own line, worded as written.",
  "Keep exercise names and comments in their original language and wording. Only the set/rep/load shape is rewritten.",
  'Never add a weight unit the text does not state: "squats 4x165" stays "Squats 4x165", not "(165kg)".',
  "One exercise or fact per line. Do not merge distinct exercises and do not repeat a line per set.",
  "If the text states when the training happened (a date, \"yesterday\", a weekday), resolve it against today's date and put it ONLY in the date field, never in the lines. Otherwise date is null.",
  "Return JSON only: no prose, no code fences.",
]
  .map((rule, index) => `${index + 1}. ${rule}`)
  .join("\n");

const NOTATION = [
  "The notation, one item per line:",
  '- Strength: "Exercise name: SETSxREPS (LOADkg)" — e.g. "Seated cable row: 3x10 (45kg)".',
  '  Dumbbell in each hand: "(16kg in each hand)". One-sided work: the words "each arm"/"each side"',
  '  come before the load — "3 sets x12 reps each arm (7.5kg)", never "(7.5kg) each arm".',
  '  Added weight over bodyweight (pull-ups, dips): keep the word "weighted" in the name — "Weighted pull-up: 4x5 (5kg)".',
  '  A machine pin position is not a weight: "Lat pulldown 3x12 (value = 6)".',
  '  Different loads per set: "Back squat 5x5: 1x80, 3x85, 1x90 (kg)". Bodyweight: just "Push-ups 3x20".',
  '- Runs/rides/swims: a first line like "5.7 km outdoor run" or "3.5 km easy run" — the distance',
  '  goes on that first line with its unit written out ("km", "m", "miles", never a bare "k").',
  '  Then one line per stated metric, as written: "5:50 per km", "cadencia - 168", "fc promedio - 146lpm".',
  '  A stated duration stays in minutes on the activity line or its own line: "20 minute run".',
  '- Commutes stay one line: "Bike to & from work".',
  '- Rounds/circuits: "4 rounds:" then one movement per line. A named benchmark keeps its name line.',
  "- Anything else (how it felt, technique notes, a swim described in prose) stays a line of prose.",
].join("\n");

function systemPrompt(): string {
  return [
    "You rewrite an athlete's free-form description of completed training into the exact line notation their training log parser reads. You transcribe; you never invent.",
    "",
    "Rules:",
    RULES,
    "",
    NOTATION,
    "",
    'Return an object with exactly these keys: {"date": "YYYY-MM-DD" or null, "lines": ["...", ...]}.',
  ].join("\n");
}

function userPrompt(input: NormalizeInput): string {
  return [`Today's local date: ${input.todayLocalDate}.`, "", "Text:", input.text].join("\n");
}

export class CloudflareTextNormalizer implements TextNormalizerProvider {
  constructor(
    private readonly ai: AiBinding,
    private readonly model: string,
    private readonly requestId: string,
  ) {}

  async normalize(input: NormalizeInput): Promise<NormalizationResult> {
    const startedAtMs = Date.now();
    const system = systemPrompt();
    const user = userPrompt(input);

    const { value, attempts } = await withSchemaRetry(
      ModelRewriteSchema,
      async ({ repairHint }) => {
        const messages: ChatMessage[] = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];
        if (repairHint !== null) {
          messages.push({ role: "user", content: repairHint });
        }
        return runJsonChat(this.ai, this.model, messages, MAX_OUTPUT_TOKENS);
      },
      { requestId: this.requestId },
    );

    const notation = value.lines.join("\n").trim();
    if (notation === "") {
      // Structurally valid but empty — not worth a repair loop of its own.
      throw new AiHttpError("schema_invalid", "The model returned an empty rewrite.", {
        attempts,
      });
    }

    return {
      notation,
      localDate: value.date,
      metadata: buildMetadata({
        provider: "cloudflare",
        model: this.model,
        promptVersion: NORMALIZER_PROMPT_VERSION,
        requestId: this.requestId,
        startedAtMs,
        attempts,
      }),
    };
  }
}
