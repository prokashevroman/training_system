import type { ParseWarning } from "@training/domain";
import type {
  ParseWorkoutInput,
  UnconsumedFragment,
  WorkoutDraft,
  WorkoutParserProvider,
} from "@training/ai-contracts";
import { ModelWorkoutDraftSchema } from "@training/ai-contracts";
import { buildMetadata, finaliseWorkoutDraft, normaliseModelDraft } from "../../draft.js";

/**
 * Deterministic offline parser.
 *
 * Not an AI simulation: a small set of regexes that produce a schema-valid draft
 * for the same input every time. That makes the whole Worker testable and
 * previewable without a Cloudflare account, and gives the web app something real
 * to render before any model is wired up.
 *
 * It follows the same rules the real prompt imposes: never invent a value, use
 * null and a warning instead, and report every fragment it did not consume.
 */

export const MOCK_PARSER_MODEL = "mock-parser-v1";
export const MOCK_PARSER_PROMPT_VERSION = "mock-workout-parser/1";

/** `3x5 at 100kg`, `3 sets of 5 at 100 kilos`, `4x8`. */
const SET_PATTERN =
  /(\d+)\s*(?:x|×|sets?\s+of)\s*(\d+)(?:\s*(?:at|@|with)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilograms?|lb|lbs|pounds?)?)?/i;
const DISTANCE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(km|kilometers?|kilometres?)\b/i;
const MINUTES_PATTERN = /(\d+)\s*(?:min|mins|minutes?)\b/i;
const RUN_PATTERN = /\b(ran|run|running|jog|jogged)\b/i;
const APPROXIMATE_PATTERN = /\b(about|approx|approximately|around|roughly|or so)\b/i;
const LB_TO_KG = 0.45359237;

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

interface BuiltActivity {
  activity: Record<string, unknown>;
  warnings: ParseWarning[];
}

function strengthActivity(fragment: string, sequence: number): BuiltActivity | null {
  const match = SET_PATTERN.exec(fragment);
  if (!match) return null;
  const sets = Number(match[1]);
  const reps = Number(match[2]);
  const loadRaw = match[3];
  const unitRaw = match[4]?.toLowerCase();
  const warnings: ParseWarning[] = [];

  const exerciseText = fragment
    .replace(SET_PATTERN, "")
    .replace(/\b(at|@|with|of)\b/gi, "")
    .trim();

  let loadValue: number | null = null;
  let loadUnit: "kg" | "lb" | "none" = "none";
  let loadKg: number | null = null;
  if (loadRaw !== undefined) {
    loadValue = toNumber(loadRaw);
    if (unitRaw === undefined) {
      // A bare number is not a kilogram. Keep the claim, refuse the conversion.
      warnings.push({
        code: "UNKNOWN_LOAD_UNIT",
        message: "A load was stated without a unit, so it was not converted to kilograms.",
        sourceFragment: fragment,
        severity: "warning",
      });
    } else if (unitRaw.startsWith("lb") || unitRaw.startsWith("pound")) {
      loadUnit = "lb";
      loadKg = Math.round(loadValue * LB_TO_KG * 100) / 100;
    } else {
      loadUnit = "kg";
      loadKg = loadValue;
    }
  }

  if (APPROXIMATE_PATTERN.test(fragment)) {
    warnings.push({
      code: "APPROXIMATE_VALUE",
      message: "The source stated this value approximately; it was kept as written.",
      sourceFragment: fragment,
      severity: "info",
    });
  }

  const strengthSets = Array.from({ length: Math.max(1, Math.min(sets, 20)) }, (_, index) => ({
    setIndex: index + 1,
    exercise: {
      rawText: exerciseText.length > 0 ? exerciseText : fragment,
      // The mock resolves no aliases: an unresolved slug is honest, a guessed
      // one silently corrupts exercise history.
      slug: null,
      apparatus: null,
      confidence: 0,
    },
    setType: "working",
    reps,
    loadValue,
    loadUnit,
    loadKg,
    loadScope: loadUnit === "none" ? "unknown" : "total",
    originalText: fragment,
  }));

  return {
    activity: {
      sequence,
      modality: "strength",
      objective: "unknown",
      intensity: "unknown",
      originalText: fragment,
      strengthSets,
    },
    warnings,
  };
}

function cardioActivity(fragment: string, sequence: number): BuiltActivity | null {
  if (!RUN_PATTERN.test(fragment)) return null;
  const distance = DISTANCE_PATTERN.exec(fragment);
  const minutes = MINUTES_PATTERN.exec(fragment);
  if (!distance && !minutes) return null;
  return {
    activity: {
      sequence,
      modality: "running",
      objective: "unknown",
      intensity: "unknown",
      distanceKm: distance?.[1] === undefined ? null : toNumber(distance[1]),
      durationSeconds: minutes?.[1] === undefined ? null : Number(minutes[1]) * 60,
      originalText: fragment,
    },
    warnings: [],
  };
}

function splitFragments(text: string): string[] {
  return text
    .split(/[\n.;]+/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

export class MockWorkoutParser implements WorkoutParserProvider {
  async parseWorkout(input: ParseWorkoutInput): Promise<WorkoutDraft> {
    const startedAtMs = Date.now();
    const activities: Record<string, unknown>[] = [];
    const warnings: ParseWarning[] = [];
    const unconsumedFragments: UnconsumedFragment[] = [];

    for (const fragment of splitFragments(input.text)) {
      const built =
        strengthActivity(fragment, activities.length + 1) ??
        cardioActivity(fragment, activities.length + 1);
      if (built === null) {
        unconsumedFragments.push({
          text: fragment,
          reason: "No structured metric was recognised in this fragment.",
        });
        continue;
      }
      activities.push(built.activity);
      warnings.push(...built.warnings);
    }

    const modalities = new Set(activities.map((activity) => activity.modality));
    const title =
      modalities.size === 0
        ? "Training session"
        : modalities.size === 1 && modalities.has("strength")
          ? "Strength session"
          : modalities.size === 1 && modalities.has("running")
            ? "Run"
            : "Mixed session";

    const raw = {
      resolvedLocalDate: input.nowLocalDate,
      sessions:
        activities.length === 0
          ? []
          : [
              {
                localDate: input.nowLocalDate,
                title,
                durationSeconds: null,
                sessionRpe: null,
                activities,
                tags: [],
              },
            ],
      warnings,
      unconsumedFragments,
    };

    // Validated through the shared schema like any real provider, so a mock that
    // drifts out of contract fails the same way a model would.
    const model = ModelWorkoutDraftSchema.parse(normaliseModelDraft(raw, input));
    return finaliseWorkoutDraft(
      model,
      buildMetadata({
        provider: "mock",
        model: MOCK_PARSER_MODEL,
        promptVersion: MOCK_PARSER_PROMPT_VERSION,
        requestId: input.requestId,
        startedAtMs,
        attempts: 1,
      }),
    );
  }
}
