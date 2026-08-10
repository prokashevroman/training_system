import type {
  ModelMetadata,
  ModelWorkoutDraft,
  ParseWorkoutInput,
  WorkoutDraft,
} from "@training/ai-contracts";
import { WarningCodeEnum } from "@training/domain";

/**
 * Server-owned draft fields.
 *
 * A model is asked for training content only. Provenance (`source`), idempotency
 * (`clientRequestKey`), the verbatim source text and the metadata block are
 * filled in here, because they are facts about the request rather than
 * interpretations of it — and because a model that invents an idempotency key
 * would break duplicate suppression on retry.
 */

/** One key per session in the response, derived from the client's idempotency key. */
export function sessionRequestKey(base: string, index: number): string {
  return `${base}:${index + 1}`;
}

/**
 * Translates a model's `null` on required enum/text fields into the schema's own
 * vocabulary for "the source did not say".
 *
 * The parser rules tell the model never to invent missing data, and a literal
 * model obeys by emitting null — but `objective`/`intensity` express that as
 * "unknown", `setType` as "working" (the deterministic importer's convention for
 * an unqualified set), and a session must carry *some* title. Mapping these here
 * is not inventing data; it spends no repair attempt on a draft whose only flaw
 * is spelling "unstated" differently than the schema does. A wrong non-null
 * value is deliberately left alone for the repair pass to catch.
 */
/**
 * The unit words the app's three source languages (en/ru/es — the same set
 * `exercise_aliases.language` admits) use for the two units the schema knows.
 * The model echoes the athlete's own words into `loadUnit` — "кг" for a Russian
 * transcript (observed live; the repair pass repeated it) — and translating a
 * spelling is not correcting a reading. Anything unrecognised passes through
 * untouched for the repair pass to judge.
 */
const LOAD_UNIT_SPELLINGS: Record<string, "kg" | "lb"> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilogramo: "kg",
  kilogramos: "kg",
  кг: "kg",
  килограмм: "kg",
  килограмма: "kg",
  килограммов: "kg",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  libra: "lb",
  libras: "lb",
  фунт: "lb",
  фунта: "lb",
  фунтов: "lb",
};

function normaliseLoadUnit(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const key = raw.trim().toLowerCase().replace(/\.+$/, "");
  return LOAD_UNIT_SPELLINGS[key] ?? raw;
}

/**
 * Fills a positional index from the array position that already encodes it.
 *
 * `sequence`, `setIndex`, `movementOrder`, `intervalIndex` and `splitOrder` are
 * all "1-based position in this array" — required by the schema, derivable
 * without a model, and pure failure surface when asked for. A circuit whose
 * movements omitted `movementOrder` is what made a Murph-prep entry fail
 * roughly two times in five; the array said the order all along.
 *
 * A value the model did supply is trusted, so a deliberate renumbering survives.
 */
function withPositionalIndex(
  raw: unknown,
  field: string,
  index: number,
  normaliseChild?: (child: unknown) => unknown,
): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const item = raw as Record<string, unknown>;
  const supplied = item[field];
  const valid = typeof supplied === "number" && Number.isInteger(supplied) && supplied > 0;
  const withIndex = { ...item, [field]: valid ? supplied : index + 1 };
  return normaliseChild ? normaliseChild(withIndex) : withIndex;
}

function mapIndexed(
  value: unknown,
  field: string,
  normaliseChild?: (child: unknown) => unknown,
): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item, index) => withPositionalIndex(item, field, index, normaliseChild));
}

/**
 * Only the unit *translation* lives here. A `null` load unit is handled
 * generically by {@link dropNullsWhereDefaulted}, which lets the schema's own
 * `"none"` default apply.
 */
function normaliseLoadFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const item = raw as Record<string, unknown>;
  if (item.loadUnit == null) return item;
  return { ...item, loadUnit: normaliseLoadUnit(item.loadUnit) };
}

function normaliseCircuit(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const circuit = raw as Record<string, unknown>;
  return {
    ...circuit,
    movements: mapIndexed(circuit.movements, "movementOrder", normaliseLoadFields),
  };
}

function normaliseBenchmark(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const benchmark = raw as Record<string, unknown>;
  return { ...benchmark, splits: mapIndexed(benchmark.splits, "splitOrder") };
}

function normaliseActivity(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const activity = raw as Record<string, unknown>;
  return {
    ...activity,
    strengthSets: mapIndexed(activity.strengthSets, "setIndex", normaliseLoadFields),
    cardioIntervals: mapIndexed(activity.cardioIntervals, "intervalIndex"),
    circuit: activity.circuit == null ? activity.circuit : normaliseCircuit(activity.circuit),
    benchmark:
      activity.benchmark == null ? activity.benchmark : normaliseBenchmark(activity.benchmark),
  };
}

const VALID_WARNING_CODES = new Set<string>(WarningCodeEnum.options);

/**
 * Drops warnings whose `code` the model made up (observed live:
 * `UNKNOWN_LOAD_SCOPE`). A warning is advisory — failing the entire draft over
 * one unrepresentable advisory row costs a repair call and often the request.
 * Rows that are malformed in other ways pass through for validation to report.
 */
function dropInventedWarnings(warnings: unknown): unknown {
  if (!Array.isArray(warnings)) return warnings;
  return warnings.filter((warning) => {
    if (typeof warning !== "object" || warning === null) return true;
    const code = (warning as Record<string, unknown>).code;
    return typeof code !== "string" || VALID_WARNING_CODES.has(code);
  });
}

/**
 * Injects the server-owned fields into raw model JSON *before* validation, so the
 * model is never asked to produce them and never penalised for omitting them.
 * Defensive throughout: `raw` is untrusted model output, not a typed value.
 */
export function normaliseModelDraft(raw: unknown, input: ParseWorkoutInput): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const draft = raw as Record<string, unknown>;
  const sessions = Array.isArray(draft.sessions) ? draft.sessions : [];

  return {
    ...draft,
    resolvedLocalDate:
      typeof draft.resolvedLocalDate === "string" ? draft.resolvedLocalDate : input.nowLocalDate,
    warnings: dropInventedWarnings(draft.warnings),
    sessions: sessions.map((session, index) => {
      if (typeof session !== "object" || session === null) return session;
      const fields = session as Record<string, unknown>;
      const rawText =
        typeof fields.rawText === "string" && fields.rawText.length > 0
          ? fields.rawText
          : input.text;
      return {
        ...fields,
        localDate: typeof fields.localDate === "string" ? fields.localDate : input.nowLocalDate,
        // Same fallback the mock parser uses when nothing better is stated.
        title:
          typeof fields.title === "string" && fields.title.trim().length > 0
            ? fields.title
            : "Training session",
        source: input.source,
        rawText,
        transcript: input.source === "voice" ? input.text : (fields.transcript ?? null),
        clientRequestKey: sessionRequestKey(input.clientRequestKey, index),
        activities: mapIndexed(fields.activities, "sequence", normaliseActivity),
      };
    }),
  };
}

export interface MetadataInput {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly requestId: string;
  readonly startedAtMs: number;
  readonly attempts: number;
  readonly nowMs?: number;
}

export function buildMetadata(input: MetadataInput): ModelMetadata {
  const now = input.nowMs ?? Date.now();
  return {
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    requestId: input.requestId,
    latencyMs: Math.max(0, now - input.startedAtMs),
    attempts: input.attempts,
  };
}

export function finaliseWorkoutDraft(
  model: ModelWorkoutDraft,
  metadata: ModelMetadata,
): WorkoutDraft {
  return { ...model, metadata };
}
