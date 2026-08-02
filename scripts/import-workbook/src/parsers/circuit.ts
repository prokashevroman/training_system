import {
  clockToSeconds,
  parseDecimal,
  parseDurationPhrase,
  warn,
  type CircuitDraft,
  type CircuitMovementDraft,
  type ParseWarning,
} from "@training/domain";
import { parseLoad } from "./load.js";

/**
 * Conditioning circuits.
 *
 * Three shapes appear in the corpus and all three are handled here:
 *   `5 rounds:` + one movement per line          (the common case)
 *   `8 rounds: 50 jumping jacks & 10 push ups`   (movements inline)
 *   `Workout: 24 minutes total, 40 seconds work, 20 seconds rest.` + Blocks
 *
 * `roundsPrescribed` and `roundsCompleted` are kept apart even though they
 * coincide in almost every cell — a workout cut short must stay honest.
 */

/** `5 rounds:`, `4 rounds (all with 2 DB 10 kg each):`, `5 rounds of:` */
const ROUNDS_HEADER = /^(\d+)\s*rounds?\b\s*(?:of\b)?\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$/i;
/** `5 strict pull-ups, 10 push ups (5 rounds)` */
const TRAILING_ROUNDS = /^(.*?)\s*\((\d+)\s*rounds?\)\s*$/i;
/** `150 push-ups (15 EMOM)` */
const EMOM = /^(.*?)\s*\((\d+)\s*emom\)\s*$/i;
/** `Workout: 24 minutes total, 40 seconds work, 20 seconds rest.` */
const INTERVAL_WORKOUT =
  /^workout:\s*(\d+)\s*minutes?\s+total,\s*(\d+)\s*seconds?\s+work,\s*(\d+)\s*seconds?\s+rest/i;
/** `10 kkal row`, `15 kkal bike (rogue)` */
const CALORIES = /^(\d+(?:\.\d+)?)\s*k?kals?\b\s*(.*)$/i;

/** Splits inline movement text on `&`, `+`, `/` and commas. */
function splitInline(text: string): string[] {
  return text
    .split(/\s*(?:&|\+|\/|,|;)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function movement(line: string, order: number, sharedLoadText: string | null): CircuitMovementDraft {
  const text = line.trim();

  // `10 kkal row` / `15 kkal bike (rogue)` — a calorie target, not reps.
  const cal = CALORIES.exec(text);
  const reps = cal ? null : /^(\d+)\s+\D/.exec(text);
  const seconds = parseDurationPhrase(text) ?? clockToSeconds(text);

  // A movement's own parenthetical load wins over the circuit-wide one.
  const own = /\(([^)]*)\)/.exec(text);
  const loadText = own?.[1] ?? sharedLoadText ?? text;
  const name = text
    .replace(/\([^)]*\)/g, "")
    .replace(/^\d+(?:\.\d+)?\s*k?kals?\b/i, "")
    .replace(/^\d+\s+/, "")
    .replace(/\s*-\s*$/, "")
    .trim();
  const load = parseLoad(loadText, name || text);

  return {
    movementOrder: order,
    exercise: { rawText: name || text, slug: null, apparatus: null, confidence: 0 },
    targetReps: reps?.[1] ? Number(reps[1]) : null,
    targetCalories: cal?.[1] ? parseDecimal(cal[1]) : null,
    targetDistanceKm: null,
    targetSeconds: seconds,
    loadValue: load.value,
    loadUnit: load.unit,
    loadKg: load.kg,
    loadScope: load.scope,
    notes: null,
    originalText: text,
  };
}

export interface CircuitParse {
  draft: CircuitDraft;
  warnings: ParseWarning[];
}

/**
 * Parses a circuit session unit. `lines[0]` is expected to be the header.
 * Returns null when the unit does not open a circuit.
 */
export function parseCircuitUnit(lines: readonly string[]): CircuitParse | null {
  const first = lines[0]?.trim() ?? "";
  const rest = lines.slice(1).map((l) => l.trim()).filter((l) => l.length > 0);
  const warnings: ParseWarning[] = [];
  const joined = lines.join("\n");

  const interval = INTERVAL_WORKOUT.exec(first);
  if (interval) {
    const movements = rest.map((line, i) => movement(line, i + 1, null));
    return {
      draft: {
        format: "interval",
        name: null,
        roundsPrescribed: null,
        roundsCompleted: null,
        partialRoundReps: null,
        timeCapSeconds: Number(interval[1]) * 60,
        completionSeconds: null,
        score: null,
        workSeconds: Number(interval[2]),
        restSeconds: Number(interval[3]),
        asPrescribed: null,
        movements,
        details: {},
        notes: null,
        originalText: joined,
      },
      warnings,
    };
  }

  const emom = EMOM.exec(first);
  if (emom) {
    return {
      draft: {
        format: "emom",
        name: null,
        roundsPrescribed: Number(emom[2]),
        roundsCompleted: Number(emom[2]),
        partialRoundReps: null,
        timeCapSeconds: null,
        completionSeconds: null,
        score: null,
        workSeconds: null,
        restSeconds: null,
        asPrescribed: null,
        movements: [movement(emom[1]!, 1, null)],
        details: {},
        notes: null,
        originalText: joined,
      },
      warnings,
    };
  }

  const trailing = TRAILING_ROUNDS.exec(first);
  if (trailing) {
    const movements = splitInline(trailing[1]!).map((m, i) => movement(m, i + 1, null));
    return {
      draft: baseDraft(Number(trailing[2]), movements, joined),
      warnings,
    };
  }

  const header = ROUNDS_HEADER.exec(first);
  if (!header) return null;

  const rounds = Number(header[1]);
  // `4 rounds (all with 2 DB 10 kg each):` — one load shared by every movement.
  const sharedLoad = header[2] ?? null;
  const inlineMovements = header[3] ? splitInline(header[3]) : [];
  const sources = [...inlineMovements, ...rest];

  if (sources.length === 0) {
    warnings.push(
      warn("PARTIAL_PARSE", `Circuit declares ${rounds} rounds but lists no movements.`, first),
    );
  }

  const movements = sources.map((m, i) => movement(m, i + 1, sharedLoad));
  return { draft: baseDraft(rounds, movements, joined), warnings };
}

function baseDraft(
  rounds: number,
  movements: CircuitMovementDraft[],
  originalText: string,
): CircuitDraft {
  return {
    format: "rounds",
    name: null,
    roundsPrescribed: rounds,
    roundsCompleted: rounds,
    partialRoundReps: null,
    timeCapSeconds: null,
    completionSeconds: null,
    score: null,
    workSeconds: null,
    restSeconds: null,
    asPrescribed: null,
    movements,
    details: {},
    notes: null,
    originalText,
  };
}
