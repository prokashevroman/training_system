import type { Modality, Objective } from "@training/domain";

/**
 * Line-level classification.
 *
 * This is an ORDERED matcher list, not one grammar. Order is load-bearing and
 * encodes the real ambiguities in the corpus:
 *
 *   - `Bike to & from work` must be a commute before it is cycling.
 *   - `12 rounds cindy` must be a benchmark before it is a generic circuit.
 *   - `Treadmill walk 70 minutes` must be walking before it is running.
 *   - `Bent over barbell row 5x10 (38 kg)` must be strength before it is
 *     rowing, while `10 kkal row` must be rowing. The discriminator is set
 *     notation, not the word "row".
 *
 * Each matcher is named so a test can assert *which* rule fired, and a
 * misclassification can be traced to one rule rather than to "the regex".
 */

export type LineKind =
  | "commute"
  | "benchmark"
  | "circuit"
  | "strength"
  | "running"
  | "walking"
  | "rowing"
  | "cycling"
  | "swimming"
  | "ski_erg"
  | "mobility"
  | "sport"
  | "dance"
  | "metric"
  | "note"
  | "unknown";

export interface LineClassification {
  kind: LineKind;
  modality: Modality | null;
  objective: Objective;
  /** Which matcher fired. Empty string when nothing matched. */
  matcher: string;
  confidence: number;
}

interface Matcher {
  name: string;
  kind: LineKind;
  test: RegExp | ((line: string) => boolean);
  confidence: number;
}

/** Set notation after normalization: `5x5`, `4 x 4`, `4X5`, `3x6`. */
export const SET_NOTATION = /\b\d+\s*x\s*\d+/i;
/** `4 sets`, `3 sets x15`, `4 sets:`. */
export const SETS_NOTATION = /\b\d+\s*sets?\b/i;

/**
 * Rowing/ski machine words that are unambiguous even without set notation.
 * `row machine`, `rowing machine`, `rowing on 7`, `10 kkal row`, `1 minute row`.
 */
const ROW_MACHINE =
  /\b(?:row(?:ing)?\s+machine|machine\s+row(?:ing)?|rowing\s+on\s+\d|k?kal\s+row|min(?:ute)?s?\s+row|row\s+approx|\d+\s*m\s+row)\b/i;

/** Strength "row" variants that must not be read as a rowing machine. */
const STRENGTH_ROW =
  /\b(?:bent\s*over|cable|low|seated|chest[-\s]?supported|single[-\s]?arm|renegade|barbell|dumbbell|db)\b[^\n]*\brows?\b/i;

const MATCHERS: Matcher[] = [
  // --- Always-standalone markers -------------------------------------------
  {
    name: "commute.bike-to",
    kind: "commute",
    // `Bike to & from work`, `Bike to & from AH XL`, `Biking to work, etc.`
    test: /^\(?\s*\+?\s*bik(?:e|ing)\s+to\b/i,
    confidence: 1,
  },
  {
    name: "commute.extra-biking",
    kind: "commute",
    // `(+ extra biking)` — a continuation of the commute line above it.
    test: /^\(\s*\+\s*(?:and\s+)?(?:more|extra)\s+biking\s*\)?$/i,
    confidence: 0.9,
  },

  // --- Benchmarks, before generic circuits ---------------------------------
  {
    name: "benchmark.murph",
    kind: "benchmark",
    // `Murph preperation`, `Full Murph`, `Half murph`, `60% murph`.
    //
    // Anchored to the line start on purpose. R22C6 ends a *mobility* line with
    // "...noticeably helps recovery after half Murph if done consistently",
    // and an unanchored /\bmurph\b/ turns that stretching note into a
    // benchmark session. It is the only mid-sentence mention in the corpus,
    // and every genuine opener leads with the name.
    test: /^(?:(?:full|half|\d+%)\s+)?murph\b/i,
    confidence: 1,
  },
  {
    name: "benchmark.cindy",
    kind: "benchmark",
    // `Cindy 11 rounds:` and `12 rounds cindy bodyweight:` — the name leads,
    // optionally behind a round count. Same anchoring rationale as Murph.
    test: /^(?:\d+\s*rounds?\s+)?cindy\b/i,
    confidence: 1,
  },

  // --- Circuits -------------------------------------------------------------
  {
    name: "circuit.n-rounds-leading",
    kind: "circuit",
    // `4 rounds:`, `5 rounds of:`, `8 rounds: 50 jumping jacks & 10 push ups`.
    test: /^\d+\s*rounds?\b/i,
    confidence: 0.95,
  },
  {
    name: "circuit.n-rounds-parenthetical",
    kind: "circuit",
    // `5 strict pull-ups, 10 push ups (5 rounds)`.
    test: /\(\s*\d+\s*rounds?\s*\)/i,
    confidence: 0.9,
  },
  {
    name: "circuit.emom",
    kind: "circuit",
    // `150 push-ups (15 EMOM)`.
    test: /\bemom\b/i,
    confidence: 0.95,
  },
  {
    name: "circuit.interval-workout",
    kind: "circuit",
    // `Workout: 24 minutes total, 40 seconds work, 20 seconds rest.`
    test: /^workout:\s*\d+\s*minutes?\s+total/i,
    confidence: 0.9,
  },
  {
    name: "circuit.interval-block",
    kind: "circuit",
    // `Block 1, 8 minutes: dumbbell swings or Russian twists.`
    test: /^block\s*\d+\s*[,:]/i,
    confidence: 0.9,
  },

  // --- Metrics, before the modality matchers so they never start a session --
  {
    name: "metric.spanish-cadence",
    kind: "metric",
    test: /^cadencia\b/i,
    confidence: 1,
  },
  {
    name: "metric.spanish-heart-rate",
    kind: "metric",
    // `fc promedio - 152lpm`, `Frec. cardiaca - 148`.
    test: /^(?:fc\s+promedio|frec\.?\s*cardiaca)\b/i,
    confidence: 1,
  },
  {
    name: "metric.bare-pace",
    kind: "metric",
    // `6:49 per km`, and the bare `6:53` line in R27C5.
    test: /^\d{1,2}:\d{2}(?:\.\d+)?\s*(?:(?:per|\/)\s*km)?\.?$/i,
    confidence: 0.9,
  },
  {
    name: "metric.elevation",
    kind: "metric",
    // `1142m - altitude gain`.
    test: /^\d+(?:\.\d+)?\s*m\s*-\s*altitude\s+gain/i,
    confidence: 1,
  },
  {
    name: "metric.total-time",
    kind: "metric",
    // `Total time: 38:11` — belongs to the benchmark above it.
    test: /^total\s+time\s*[:=-]/i,
    confidence: 1,
  },
  {
    name: "metric.interval-pace-list",
    kind: "metric",
    // `Fast intervals pace: 4:52 - 4:32`, always directly under
    // `Norwegian VO2 max running training:` — it is that run's interval data.
    test: /^fast\s+intervals?\s+pace\s*[:=]/i,
    confidence: 1,
  },

  // --- Prose notes, before the movement-keyword fallback -------------------
  {
    name: "note.prose",
    kind: "note",
    // `quality of some squats wasn't deep enough` and `Heart rate went up in
    // the beginning because was nervous` (both R24C8) name movements or
    // metrics in passing. Without this they become a phantom strength set.
    test: /^(?:quality\s+of|heart\s+rate\s+went|stopped\s+on|after\s+did)\b/i,
    confidence: 0.8,
  },

  // --- Strength, before rowing so `... row 5x10` is not a rowing machine ----
  {
    name: "strength.qualified-row",
    kind: "strength",
    test: STRENGTH_ROW,
    confidence: 0.9,
  },
  {
    name: "strength.set-notation",
    kind: "strength",
    // `Back squat 5x5: ...`, `4x10 lat pulldown`, `3x3 strict pull ups`.
    // Guarded against cardio lines that merely contain a time or a distance.
    test: (line) => SET_NOTATION.test(line) && !isCardioContext(line),
    confidence: 0.85,
  },
  {
    name: "strength.sets-notation",
    kind: "strength",
    // `4 sets: 4x70; 3 - 3x75`, `3 sets x15 reps each leg`.
    test: (line) => SETS_NOTATION.test(line) && !isCardioContext(line),
    confidence: 0.85,
  },
  {
    name: "strength.movement-keyword",
    kind: "strength",
    test: (line) => STRENGTH_MOVEMENT.test(line) && !isCardioContext(line),
    confidence: 0.7,
  },

  // --- Cardio modalities ----------------------------------------------------
  {
    name: "walking.hiking",
    kind: "walking",
    // Before running: `walking treadmill 4.5 km`, `Treadmill walk 70 minutes`.
    test: /\b(?:walk(?:ing|ed)?|hik(?:e|ing)|steps)\b/i,
    confidence: 0.9,
  },
  {
    name: "rowing.machine",
    kind: "rowing",
    test: ROW_MACHINE,
    confidence: 0.9,
  },
  {
    name: "ski.erg",
    kind: "ski_erg",
    // `Ski machine, 1000m, pace 1:54`.
    test: /\bski\s*(?:machine|erg)\b/i,
    confidence: 0.95,
  },
  {
    name: "swimming",
    kind: "swimming",
    test: /\b(?:swim(?:ming)?|front\s+crawl)\b/i,
    confidence: 0.95,
  },
  {
    name: "running.miles",
    kind: "running",
    // R15C6 records a run only as `2.76 miles, 30:26 (6:51 per km, ...)` with
    // no `run` keyword at all. `miles` appears nowhere else in the corpus.
    test: /\b\d+(?:\.\d+)?\s*miles?\b/i,
    confidence: 0.85,
  },
  {
    name: "running",
    kind: "running",
    // `10 km outdoor run`, `Treadmill easy run`, `Beach run - 4km`, `Treadmil`.
    test: /\b(?:runs?|running|jog(?:ging)?|treadmill?)\b/i,
    confidence: 0.9,
  },
  {
    name: "cycling",
    kind: "cycling",
    // `45 minutes VO2 cardio (Air bike)`, `Bike 1 hour total`, `easy bike ride`.
    test: /\b(?:air\s*bike|bike|biking|cycling|rogue)\b/i,
    confidence: 0.85,
  },

  // --- Recovery and other ---------------------------------------------------
  {
    name: "mobility",
    kind: "mobility",
    // `Rolling and stretching shoulder and lads 30 minutes total`, `massage`.
    test: /\b(?:roll(?:ing)?|stretch(?:ing)?|massage|mobility|foam)\b/i,
    confidence: 0.95,
  },
  {
    name: "sport.outdoor",
    kind: "sport",
    // `Surfing training (2 hours)`, `light kayaking`.
    test: /\b(?:surf(?:ing)?|kayak(?:ing)?|climbing)\b/i,
    confidence: 0.95,
  },
  {
    name: "dance",
    kind: "dance",
    // `Dance training with a lot of lifts`.
    test: /\bdance\b/i,
    confidence: 0.95,
  },
  {
    name: "cardio.vo2-generic",
    kind: "cycling",
    // `VO2 max 20 min air bike` is caught above; this catches a bare
    // `25 minutes VO2 cardio` with the machine named only in parentheses.
    test: /\bvo2\b/i,
    confidence: 0.6,
  },
];

/**
 * Movement names observed in the corpus. Used only as a fallback when there is
 * no set notation — e.g. `120 push-ups (10 kg)`, `11 strict pull ups`,
 * `30 push ups unbroken`, `Sled push (75 kg approx)`.
 */
const STRENGTH_MOVEMENT =
  /\b(?:squats?|deadlifts?|deadlifw|dl|rdl|bench\s*press|press|pull[-\s]?ups?|pull\s*kipping|pullups?|push[-\s]?ups?|pushups?|dips?|curls?|fly|raises?|pulldown|pressdown|thrusters?|swings?|lunges?|planks?|crunch(?:es)?|carry|dead\s*hang|snatch|cleans?|jerk|muscle[-\s]?ups?|\bmu\b|step[-\s]?ups?|wall\s*balls?|devil\s*press|sled|burpees?|hip\s*thrusts?|split\s*squat|leg\s*curl|paralets|parallettes|shoulder\s*taps?|jumping\s*jacks?|high\s*knees|superman|abs)\b/i;

/**
 * True when a line is really about distance/pace/time rather than lifting.
 * Without this, `Row machine: 1000m, 4:31, 2:14.9/500m` would be read as
 * strength because `2:14.9/500m` contains no `x` but `4x4` style tokens do
 * appear in nearby cardio text.
 */
function isCardioContext(line: string): boolean {
  if (STRENGTH_ROW.test(line)) return false;
  return (
    ROW_MACHINE.test(line) ||
    /\bski\s*(?:machine|erg)\b/i.test(line) ||
    /\b(?:per|\/)\s*(?:km|500\s*m)\b/i.test(line) ||
    /\bspeed\s*=/i.test(line)
  );
}

const MODALITY_BY_KIND: Readonly<Record<LineKind, Modality | null>> = {
  commute: "cycling",
  benchmark: "hybrid_conditioning",
  circuit: "hybrid_conditioning",
  strength: "strength",
  running: "running",
  walking: "walking_hiking",
  rowing: "rowing",
  cycling: "cycling",
  swimming: "swimming",
  ski_erg: "ski_erg",
  mobility: "mobility_recovery",
  sport: "sport_outdoor",
  dance: "dance",
  metric: null,
  note: null,
  unknown: null,
};

function inferObjective(line: string, kind: LineKind): Objective {
  if (kind === "commute") return "commute";
  if (kind === "mobility") return "recovery";
  if (/\bvo2\b/i.test(line) || /\bnorwegian\b/i.test(line)) return "vo2max";
  if (/\bzone\s*2\b|\beasy\b/i.test(line)) return "aerobic_base";
  if (/\btempo\b|\bthreshold\b/i.test(line)) return "tempo_threshold";
  if (kind === "benchmark") return "race_specific";
  if (kind === "circuit") return "hybrid_conditioning";
  if (kind === "strength") return "max_strength";
  if (kind === "running" || kind === "walking" || kind === "swimming") return "aerobic_base";
  return "unknown";
}

export function classifyLine(line: string): LineClassification {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { kind: "unknown", modality: null, objective: "unknown", matcher: "", confidence: 0 };
  }

  for (const m of MATCHERS) {
    const hit = typeof m.test === "function" ? m.test(trimmed) : m.test.test(trimmed);
    if (!hit) continue;
    return {
      kind: m.kind,
      modality: MODALITY_BY_KIND[m.kind],
      objective: inferObjective(trimmed, m.kind),
      matcher: m.name,
      confidence: m.confidence,
    };
  }

  return { kind: "note", modality: null, objective: "unknown", matcher: "fallback.note", confidence: 0.2 };
}

/** Kinds that never carry a session on their own; they attach to what precedes. */
export const ATTACHING_KINDS: ReadonlySet<LineKind> = new Set<LineKind>(["metric", "note", "unknown"]);
