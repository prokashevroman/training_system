import {
  parseDecimal,
  toKilograms,
  warn,
  type LoadScope,
  type LoadUnit,
  type ParseWarning,
} from "@training/domain";

/**
 * Load extraction — the distinction this project exists to preserve.
 *
 * The corpus records four genuinely different things with the same shape of
 * number, and collapsing them into a single "kg" column silently corrupts
 * every strength trend downstream:
 *
 *   Back squat 5x5: 1x80, 3x85, 1x90       -> total
 *   8x20 kg in each hand                   -> per_hand   (not a 20 kg lift)
 *   Weighted strict pull-up: 4x5 (5kg)     -> added_bodyweight
 *   4x10 lat pulldown (value = 6)          -> machine_setting  (a pin, not 6 kg)
 *   210 or 215lb / 4x165                   -> unknown + warning
 *
 * Only `total`, `per_hand`, `per_side` and `added_bodyweight` ever produce a
 * kilogram figure, and only when the source stated a unit.
 */

export interface ParsedLoad {
  value: number | null;
  unit: LoadUnit;
  kg: number | null;
  scope: LoadScope;
  /** The exact substring the load was read from. */
  originalText: string;
  warnings: ParseWarning[];
}

/** `value = 6`, `weight 5`, `rowing on 7` — a machine setting, never kilograms. */
const MACHINE_SETTING = /\b(?:value\s*=\s*(\d+(?:\.\d+)?)|weight\s+(\d+(?:\.\d+)?)\b(?!\s*kg))/i;
const MACHINE_ON = /\b(?:rowing|row)\s+on\s+(\d+(?:\.\d+)?)/i;

/** `210 or 215lb` — the source itself is undecided, so no value is recorded. */
const AMBIGUOUS_ALTERNATIVE = /(\d+(?:\.\d+)?)\s*(?:or)\s*(\d+(?:\.\d+)?)\s*(kg|lb)?/i;

/** `20 kg in each hand`, `2xDB 18 kg each`, `14kg in each hand`, `2 dumbbell 10 kg each`. */
const PER_HAND =
  /(?:in\s+each\s+hand|each\s+hand|\beach\b(?=\s*\)|\s*$)|\b2\s*x\s*(?:db|dumbbells?)\b|\bdb\s*2\s*x|\b2\s*(?:db|dumbbells?)\s*x)/i;

/** `each leg`, `each arm`, `each side`. */
const PER_SIDE = /\beach\s+(?:leg|arm|side)\b/i;

/**
 * Movements whose base load is the athlete, so an added plate or vest is
 * `added_bodyweight` rather than the total lifted.
 */
const BODYWEIGHT_BASE =
  /\b(?:push[-\s]?ups?|pull[-\s]?ups?|pull\s*kipping|dips?|air\s*squats?|muscle[-\s]?ups?|burpees?|plank|sit[-\s]?ups?|chin[-\s]?ups?)\b/i;

/** A bare `squats` is bodyweight; `back squat` / `front squat` are barbell. */
const BARE_SQUAT = /(?<!back\s|front\s|goblet\s|split\s|jump\s)\bsquats?\b/i;
const LOADED_BARBELL =
  /\b(?:back\s*squat|front\s*squat|bench\s*press|deadlift|deadlifw|hex\s*bar|barbell|romanian)\b/i;

/** `5 kg`, `72.5kg`, `155lb`, `20lb`. Unit is required. */
const WEIGHT_WITH_UNIT = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|lb|lbs|pounds?)\b/i;

function unitOf(raw: string): LoadUnit {
  return /^(?:lb|lbs|pounds?)$/i.test(raw) ? "lb" : "kg";
}

function none(originalText: string, warnings: ParseWarning[] = []): ParsedLoad {
  return { value: null, unit: "none", kg: null, scope: "unknown", originalText, warnings };
}

/**
 * Reads the load out of one exercise line.
 *
 * `exerciseText` is the movement name (used to decide whether a load is added
 * to bodyweight); `loadText` is the fragment the load lives in, which is
 * usually a parenthetical or the tail of the line.
 */
export function parseLoad(loadText: string, exerciseText = loadText): ParsedLoad {
  const text = loadText.trim();

  // Machine settings first: `(value = 6)` also contains a bare number that the
  // generic matchers would happily read as kilograms.
  const machine = MACHINE_SETTING.exec(text) ?? MACHINE_ON.exec(text);
  if (machine) {
    const raw = machine[1] ?? machine[2];
    const value = raw ? parseDecimal(raw) : null;
    return {
      value,
      unit: "none",
      kg: null,
      scope: "machine_setting",
      originalText: machine[0],
      warnings: [
        warn(
          "MACHINE_SETTING_NOT_KG",
          `"${machine[0].trim()}" is a machine setting, not a weight; it is stored unconverted.`,
          machine[0],
        ),
      ],
    };
  }

  // `210 or 215lb` — record neither, and say why.
  const alternative = AMBIGUOUS_ALTERNATIVE.exec(text);
  if (alternative && /\bor\b/i.test(text)) {
    return none(alternative[0], [
      warn(
        "AMBIGUOUS_LOAD_VALUE",
        `The source records two possible loads ("${alternative[0].trim()}") and does not say which was used.`,
        alternative[0],
      ),
    ]);
  }

  const scope = detectScope(text, exerciseText);

  const withUnit = WEIGHT_WITH_UNIT.exec(text);
  if (withUnit?.[1] && withUnit[2]) {
    const value = parseDecimal(withUnit[1])!;
    const unit = unitOf(withUnit[2]);
    const approximate = /\bapprox(?:imately)?\b/i.test(text);
    const converted = toKilograms(value, unit, { approximate });
    const warnings: ParseWarning[] = [];
    if (approximate) {
      warnings.push(
        warn("APPROXIMATE_VALUE", `The source marks this load approximate.`, withUnit[0]),
      );
    }
    if (scope === "per_hand" || scope === "per_side") {
      warnings.push(
        warn(
          "PER_SIDE_LOAD",
          `${value} ${unit} is per ${scope === "per_hand" ? "hand" : "side"}, not total system load.`,
          text,
        ),
      );
    }
    return {
      value,
      unit,
      kg: converted.value,
      scope,
      originalText: withUnit[0],
      warnings,
    };
  }

  return none(text);
}

/**
 * Decides what a load number measures, given the movement it belongs to.
 * Exported so the strength parser can classify a load it extracted itself.
 */
export function detectScope(loadText: string, exerciseText: string): LoadScope {
  if (PER_HAND.test(loadText) || PER_HAND.test(exerciseText)) return "per_hand";
  if (PER_SIDE.test(loadText) || PER_SIDE.test(exerciseText)) return "per_side";
  if (LOADED_BARBELL.test(exerciseText)) return "total";
  if (BODYWEIGHT_BASE.test(exerciseText) || BARE_SQUAT.test(exerciseText)) {
    return "added_bodyweight";
  }
  return "total";
}

/**
 * Attaches a unit to a bare load number, or refuses to.
 *
 * `4x165` (R12C2) and `1x80` both look the same, but `1x80` sits under a
 * `Back squat 5x5:` header in a cell where every other load is in kilograms,
 * while `4x165` sits among pound figures. Neither is safe to assume, so a bare
 * number is recorded with `unit: none` and `kg: null` plus a warning. The
 * original value is never lost — only the conversion is withheld.
 */
export function bareLoad(value: number, originalText: string, scope: LoadScope): ParsedLoad {
  return {
    value,
    unit: "none",
    kg: null,
    scope,
    originalText,
    warnings: [
      warn(
        "UNKNOWN_LOAD_UNIT",
        `"${originalText.trim()}" states no unit; kilograms and pounds differ too much to guess.`,
        originalText,
      ),
    ],
  };
}
