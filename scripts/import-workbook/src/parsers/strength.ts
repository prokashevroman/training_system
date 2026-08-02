import { parseDecimal, toKilograms, warn, type ParseWarning } from "@training/domain";
import { bareLoad, detectScope, parseLoad, type ParsedLoad } from "./load.js";

/**
 * Strength set notation.
 *
 * An ORDERED matcher list, not one grammar. Each rule is named, carries a
 * confidence, and is tried in turn; a line no rule claims falls through to
 * review rather than being coerced into a shape.
 *
 * The subtlety that makes one grammar impossible: the meaning of `AxB` in the
 * detail depends on what the header already supplied.
 *
 *   Back squat 5x5: 1x80, 3x85, 1x90     header gives reps -> 1,3,1 are SETS
 *                                        (and 1+3+1 = 5, the header set count)
 *   Bench press: 4 sets: 4x70; 3 - 3x75  header gives no reps -> 4 is REPS
 *                                        (reading it as sets would total 7 > 4)
 *
 * Both readings appear in the same workbook, sometimes in the same cell.
 */

export interface SetSpec {
  sets: number;
  reps: number | null;
  holdSeconds: number | null;
  load: ParsedLoad;
  originalText: string;
}

export interface StrengthParse {
  exerciseText: string;
  specs: SetSpec[];
  matcher: string;
  confidence: number;
  warnings: ParseWarning[];
}

const WEIGHT_UNIT = "(kg|kgs|lb|lbs)";

/** Whether the detail's leading number counts sets or reps. */
type DetailContext = "sets" | "reps";

interface Matcher {
  name: string;
  confidence: number;
  re: RegExp;
  build: (m: RegExpExecArray, line: string) => StrengthParse | null;
}

const cleanName = (s: string): string => s.replace(/[,:;\s]+$/, "").replace(/^[,:;\s]+/, "").trim();

/** `2:00`-style holds: `Plank: 4x1 min`, `1 minute dead hang`. */
function holdFrom(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|sec(?:ond)?s?)\b/i.exec(text);
  if (!m?.[1]) return null;
  const n = parseDecimal(m[1])!;
  return /^s/i.test(m[2]!) ? n : n * 60;
}

/**
 * Parses one comma/semicolon-separated detail entry into set specs.
 * `context` decides whether a leading count means sets or reps.
 */
function parseDetailEntry(
  entry: string,
  context: DetailContext,
  headerSets: number,
  headerReps: number | null,
  exerciseText: string,
): SetSpec[] | null {
  const text = entry.trim();
  if (text.length === 0) return null;

  const scope = detectScope(text, exerciseText);
  const mk = (sets: number, reps: number | null, load: ParsedLoad): SetSpec[] => [
    { sets, reps, holdSeconds: holdFrom(text), load, originalText: text },
  ];

  // `3 - 3x75` / `3 - 3x110`: N sets of R reps at weight W.
  const setsThenRepsWeight = new RegExp(
    `^(\\d+)\\s*-\\s*(\\d+)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*${WEIGHT_UNIT}?$`,
    "i",
  ).exec(text);
  if (setsThenRepsWeight) {
    return mk(
      Number(setsThenRepsWeight[1]),
      Number(setsThenRepsWeight[2]),
      weight(setsThenRepsWeight[3]!, setsThenRepsWeight[4], text, scope),
    );
  }

  // Weight-first: `80kg x6`, `65kg x6`. Always weight then reps.
  const weightFirst = new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*${WEIGHT_UNIT}\\s*x\\s*(\\d+)$`,
    "i",
  ).exec(text);
  if (weightFirst) {
    return mk(headerSets, Number(weightFirst[3]), weight(weightFirst[1]!, weightFirst[2], text, scope));
  }

  // `x95` — no count, so the weight applies to every set the header declared.
  const allSets = new RegExp(`^x\\s*(\\d+(?:\\.\\d+)?)\\s*${WEIGHT_UNIT}?$`, "i").exec(text);
  if (allSets) {
    return mk(headerSets, headerReps, weight(allSets[1]!, allSets[2], text, scope));
  }

  // `1x80`, `3x95 kg`, `1-90kg`, `4x155lb`. The leading number's meaning is
  // context-dependent; the weight is always the trailing number.
  const countWeight = new RegExp(
    `^(\\d+)\\s*[x-]\\s*(\\d+(?:\\.\\d+)?)\\s*${WEIGHT_UNIT}?(?:\\s*x\\s*(\\d+))?$`,
    "i",
  ).exec(text);
  if (countWeight) {
    const count = Number(countWeight[1]);
    const load = weight(countWeight[2]!, countWeight[3], text, scope);
    // `5x155lb x2` — a trailing `xN` is an explicit set count.
    const trailingSets = countWeight[4] ? Number(countWeight[4]) : null;
    if (trailingSets !== null) return mk(trailingSets, count, load);
    return context === "sets" ? mk(count, headerReps, load) : mk(headerSets, count, load);
  }

  // A bare weight: `(60 kg)`, `(107 kg)`, `(52kg)`, `(value = 6)`.
  const load = parseLoad(text, exerciseText);
  if (load.value !== null || load.scope === "machine_setting") {
    return mk(headerSets, headerReps, load);
  }

  return null;
}

function weight(
  raw: string,
  unitRaw: string | undefined,
  originalText: string,
  scope: ReturnType<typeof detectScope>,
): ParsedLoad {
  const value = parseDecimal(raw);
  if (value === null) return bareLoad(0, originalText, scope);
  if (!unitRaw) return bareLoad(value, originalText, scope);
  const unit = /^lbs?$/i.test(unitRaw) ? "lb" : "kg";
  const converted = toKilograms(value, unit);
  const warnings: ParseWarning[] = [];
  if (scope === "per_hand" || scope === "per_side") {
    warnings.push(
      warn(
        "PER_SIDE_LOAD",
        `${value} ${unit} is per ${scope === "per_hand" ? "hand" : "side"}, not total load.`,
        originalText,
      ),
    );
  }
  return { value, unit, kg: converted.value, scope, originalText, warnings };
}

function splitDetail(detail: string): string[] {
  return detail
    .split(/[;,]|\s\+\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fromDetail(
  name: string,
  headerSets: number,
  headerReps: number | null,
  detail: string,
  context: DetailContext,
  matcher: string,
  confidence: number,
  line: string,
): StrengthParse | null {
  const exerciseText = cleanName(name);
  const specs: SetSpec[] = [];
  const warnings: ParseWarning[] = [];
  const leftovers: string[] = [];

  // `(1-90kg, 3-95kg)` wraps the whole detail, so the parens must come off
  // before splitting or the commas tear the brackets apart. A parenthetical at
  // the *end* is different — `80kg x6 (90kg last one)` is a note qualifying an
  // otherwise complete detail, and is kept verbatim rather than parsed.
  let body = detail.trim();
  let note: string | null = null;
  if (/^\(.*\)$/.test(body)) {
    body = body.slice(1, -1).trim();
  } else {
    const trailing = /\(([^)]*)\)\s*$/.exec(body);
    if (trailing) {
      note = trailing[1]!.trim();
      body = body.slice(0, trailing.index).trim();
    }
  }

  for (const entry of splitDetail(body)) {
    const parsed = parseDetailEntry(entry, context, headerSets, headerReps, exerciseText);
    if (parsed) {
      specs.push(...parsed);
      for (const s of parsed) warnings.push(...s.load.warnings);
    } else {
      leftovers.push(entry);
    }
  }

  if (specs.length === 0) return null;

  if (note) {
    // `(90kg last one)`, `(60kg 1st, 5 reps 65 lasst)` — a real variation the
    // matcher cannot represent as sets. Preserved so nothing is lost.
    warnings.push(
      warn(
        "PARTIAL_PARSE",
        `Set-level variation kept as a note rather than guessed at: "${note}".`,
        note,
      ),
    );
  }

  if (leftovers.length > 0) {
    warnings.push(
      warn(
        "PARTIAL_PARSE",
        `Understood the sets but not: ${leftovers.map((l) => `"${l}"`).join(", ")}.`,
        leftovers.join("; "),
      ),
    );
  }

  // A detail whose set counts disagree with the header is a parse we do not
  // trust — flag it rather than quietly recording the wrong number of sets.
  if (context === "sets") {
    const total = specs.reduce((n, s) => n + s.sets, 0);
    if (total !== headerSets) {
      warnings.push(
        warn(
          "PARTIAL_PARSE",
          `Header declares ${headerSets} sets but the detail accounts for ${total}.`,
          line,
        ),
      );
    }
  }

  return { exerciseText, specs, matcher, confidence, warnings };
}

const MATCHERS: Matcher[] = [
  {
    // `Plank: 4x1 min` — four sets of a one-minute hold. Must precede the
    // generic set matchers, which would read the `1` as a rep count and lose
    // the duration entirely.
    name: "strength.sets-x-hold",
    confidence: 0.9,
    re: /^(.+?)[,:]?\s*(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|sec(?:ond)?s?)\b/i,
    build: (m) => {
      const exerciseText = cleanName(m[1]!);
      const n = parseDecimal(m[3]!)!;
      const holdSeconds = /^s/i.test(m[4]!) ? n : n * 60;
      return {
        exerciseText,
        specs: [
          {
            sets: Number(m[2]),
            reps: null,
            holdSeconds,
            load: parseLoad("", exerciseText),
            originalText: m[0],
          },
        ],
        matcher: "strength.sets-x-hold",
        confidence: 0.9,
        warnings: [],
      };
    },
  },
  {
    // `Back squat 5x5: 1x80, 3x85, 1x90` / `Bench press 4x4: 1x70 kg, 3x72.5 kg`
    // / `Back squat 4x4: x95` / `Deadlift 4x3: 4x105`
    name: "strength.sets-x-reps-colon-detail",
    confidence: 0.95,
    re: /^(.+?)[,:]?\s*(\d+)\s*x\s*(\d+)\s*:\s*(.+)$/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "sets", "strength.sets-x-reps-colon-detail", 0.95, line),
  },
  {
    // `Back squats: 4 sets x3: 3x95; 1x100`
    name: "strength.n-sets-x-reps-colon-detail",
    confidence: 0.95,
    re: /^(.+?)[,:]?\s*(\d+)\s*sets?\s*x\s*(\d+)\s*(?:reps?)?\s*:\s*(.+)$/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "sets", "strength.n-sets-x-reps-colon-detail", 0.95, line),
  },
  {
    // `Bench press: 4 sets: 4x70; 3 - 3x75` / `Back squat, 4 sets: 80kg x6`
    // / `Single-arm lateral raise cable, 3 sets: 3x15 each hand weight 5`
    name: "strength.n-sets-colon-detail",
    confidence: 0.9,
    re: /^(.+?)[,:]?\s*(\d+)\s*sets?\s*:\s*(.+)$/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), null, m[3]!, "reps", "strength.n-sets-colon-detail", 0.9, line),
  },
  {
    // `Cable leg curl, 3 sets x15 reps each leg (7.5kg)`
    // `Bulgarian split squat, 3 sets x 8reps each leg (14kg in each hand)`
    name: "strength.n-sets-x-reps-trailing-load",
    confidence: 0.9,
    re: /^(.+?)[,:]?\s*(\d+)\s*sets?\s*x\s*(\d+)\s*(?:reps?)?\b(.*)$/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "sets", "strength.n-sets-x-reps-trailing-load", 0.9, line) ??
      simple(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "strength.n-sets-x-reps-trailing-load", 0.9),
  },
  {
    // `Bench press: 2x4 + 2x5 (52kg)` — two differently-sized blocks sharing
    // one load. Must precede the paren-load matcher, whose lazy name group
    // would otherwise swallow `2x4 +` and record only the second block.
    name: "strength.summed-set-blocks",
    confidence: 0.9,
    re: /^(.+?)[,:]?\s*(\d+\s*x\s*\d+(?:\s*\+\s*\d+\s*x\s*\d+)+)\s*(?:\(([^)]*)\))?\s*$/i,
    build: (m) => {
      const exerciseText = cleanName(m[1]!);
      const load = parseLoad(m[3] ?? "", exerciseText);
      const specs: SetSpec[] = [];
      for (const block of m[2]!.split("+")) {
        const b = /(\d+)\s*x\s*(\d+)/.exec(block.trim());
        if (!b) continue;
        specs.push({
          sets: Number(b[1]),
          reps: Number(b[2]),
          holdSeconds: null,
          load,
          originalText: block.trim(),
        });
      }
      if (specs.length === 0) return null;
      return {
        exerciseText,
        specs,
        matcher: "strength.summed-set-blocks",
        confidence: 0.9,
        warnings: load.warnings,
      };
    },
  },
  {
    // `Bench press 5x5 (60 kg)` / `Deadlift with Hex bar: 4X4 (107 kg)`
    // / `Front squat, 3x6 (DB 2x24kg)` / `Weighted strict pull-up: 4x5 (5kg)`
    name: "strength.sets-x-reps-paren-load",
    confidence: 0.92,
    re: /^(.+?)[,:]?\s*(\d+)\s*x\s*(\d+)\s*\(([^)]*)\)/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "sets", "strength.sets-x-reps-paren-load", 0.92, line) ??
      simple(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "strength.sets-x-reps-paren-load", 0.92),
  },
  {
    // `4x10 lat pulldown (value = 6)` / `3x3 strict pull ups` / `4x15 squats`
    name: "strength.leading-sets-x-reps",
    confidence: 0.88,
    re: /^(\d+)\s*x\s*(\d+)\s+([a-z].*)$/i,
    build: (m) => simple(m[3]!, Number(m[1]), Number(m[2]), m[3]!, "strength.leading-sets-x-reps", 0.88),
  },
  {
    // `Bench press 4x4 (70kg)` with no colon, `Back squat 4x4: 90kg`
    name: "strength.sets-x-reps-trailing-load",
    confidence: 0.85,
    re: /^(.+?)[,:]?\s*(\d+)\s*x\s*(\d+)\b(.*)$/i,
    build: (m, line) =>
      fromDetail(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "sets", "strength.sets-x-reps-trailing-load", 0.85, line) ??
      simple(m[1]!, Number(m[2]), Number(m[3]), m[4]!, "strength.sets-x-reps-trailing-load", 0.85),
  },
  {
    // `4x155lb` under a bare `Bench press:` header — reps x weight, no sets.
    name: "strength.reps-x-weight-unit",
    confidence: 0.8,
    re: new RegExp(`^(\\d+)\\s*x\\s*(\\d+(?:\\.\\d+)?)\\s*${WEIGHT_UNIT}(?:\\s*x\\s*(\\d+))?$`, "i"),
    build: (m) => {
      const scope = detectScope(m[0], "");
      const load = weight(m[2]!, m[3], m[0], scope);
      return {
        exerciseText: "",
        specs: [
          {
            sets: m[4] ? Number(m[4]) : 1,
            reps: Number(m[1]),
            holdSeconds: null,
            load,
            originalText: m[0],
          },
        ],
        matcher: "strength.reps-x-weight-unit",
        confidence: 0.8,
        warnings: load.warnings,
      };
    },
  },
  {
    // `4x165` (R12C2) — a bare pair with no movement name and no unit.
    //
    // It sits under a `Bench press:` header beside `4х155lb` and `5x155lb x2`,
    // so the leading number is reps and the trailing one is the load. The
    // guard on the second number keeps this rule away from genuine set x rep
    // pairs: no set scheme in this corpus prescribes more than 50 reps, while
    // every load written this way exceeds it.
    name: "strength.reps-x-bare-weight",
    confidence: 0.6,
    re: /^(\d+)\s*x\s*(\d+(?:\.\d+)?)$/,
    build: (m) => {
      const value = parseDecimal(m[2]!)!;
      if (value <= 50) return null;
      const load = bareLoad(value, m[0], "total");
      return {
        exerciseText: "",
        specs: [
          { sets: 1, reps: Number(m[1]), holdSeconds: null, load, originalText: m[0] },
        ],
        matcher: "strength.reps-x-bare-weight",
        confidence: 0.6,
        warnings: load.warnings,
      };
    },
  },
  {
    // `120 push-ups (10 kg)` / `11 strict pull ups` / `100 push ups with plate 5 kg`
    name: "strength.reps-then-movement",
    confidence: 0.75,
    re: /^(\d+)\s+([a-z][^()]*?)(?:\s*\(([^)]*)\))?\s*$/i,
    build: (m) => {
      // The captured name may trail into the load (`push ups with plate 5 kg`),
      // so strip the load phrase off the name but parse it from the full line.
      const name = cleanName(
        m[2]!
          .replace(/\s+(?:with|at)\s+.*$/i, "")
          .replace(/\s*\d+(?:\.\d+)?\s*(?:kg|lb)s?\b.*$/i, ""),
      );
      const load = parseLoad(m[3] ?? m[0], name || m[0]);
      return {
        exerciseText: name,
        specs: [{ sets: 1, reps: Number(m[1]), holdSeconds: null, load, originalText: m[0] }],
        matcher: "strength.reps-then-movement",
        confidence: 0.75,
        warnings: load.warnings,
      };
    },
  },
  {
    // `Max push ups (25)` — an AMRAP test where the parenthetical is the score.
    name: "strength.max-effort",
    confidence: 0.8,
    re: /^max\s+([a-z][a-z\s-]*?)\s*\((\d+)\)\s*$/i,
    build: (m) => ({
      exerciseText: cleanName(m[1]!),
      specs: [
        {
          sets: 1,
          reps: Number(m[2]),
          holdSeconds: null,
          load: parseLoad("", m[1]!),
          originalText: m[0],
        },
      ],
      matcher: "strength.max-effort",
      confidence: 0.8,
      warnings: [],
    }),
  },
  {
    // `Test Deadlifts (97 kg with hex bar)` — a one-rep-max style test set.
    name: "strength.test-set",
    confidence: 0.75,
    re: /^test\s+([a-z][a-z\s-]*?)\s*\(([^)]*)\)\s*$/i,
    build: (m) => {
      const name = cleanName(m[1]!);
      const load = parseLoad(m[2]!, name);
      return {
        exerciseText: name,
        specs: [{ sets: 1, reps: null, holdSeconds: null, load, originalText: m[0] }],
        matcher: "strength.test-set",
        confidence: 0.75,
        warnings: load.warnings,
      };
    },
  },
];

/** Builds a uniform block of `sets` identical sets, reading a load from `detail`. */
function simple(
  name: string,
  sets: number,
  reps: number,
  detail: string,
  matcher: string,
  confidence: number,
): StrengthParse {
  const exerciseText = cleanName(name);
  const load = parseLoad(detail, exerciseText);
  return {
    exerciseText,
    specs: [
      { sets, reps, holdSeconds: holdFrom(detail), load, originalText: detail.trim() || name },
    ],
    matcher,
    confidence,
    warnings: load.warnings,
  };
}

/** Runs the matcher list. Returns null when no rule claims the line. */
export function parseStrengthLine(line: string): StrengthParse | null {
  const text = line.trim();
  for (const m of MATCHERS) {
    const hit = m.re.exec(text);
    if (!hit) continue;
    const built = m.build(hit, text);
    if (built && built.specs.length > 0) return built;
  }
  return null;
}

/** Expands set specs into one record per performed set, in source order. */
export function expandSets(parse: StrengthParse, startIndex = 1): {
  setIndex: number;
  reps: number | null;
  holdSeconds: number | null;
  load: ParsedLoad;
  originalText: string;
}[] {
  const out: ReturnType<typeof expandSets> = [];
  let index = startIndex;
  for (const spec of parse.specs) {
    for (let i = 0; i < Math.max(1, spec.sets); i += 1) {
      out.push({
        setIndex: index,
        reps: spec.reps,
        holdSeconds: spec.holdSeconds,
        load: spec.load,
        originalText: spec.originalText,
      });
      index += 1;
    }
  }
  return out;
}
