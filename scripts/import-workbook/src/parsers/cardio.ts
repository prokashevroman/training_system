import {
  clockToSeconds,
  parseDecimal,
  parseDurationPhrase,
  toKilometres,
  warn,
  type ParseWarning,
} from "@training/domain";

/**
 * Cardio metric extraction: distance, duration, pace, speed, heart rate,
 * cadence, calories, elevation.
 *
 * The rule that matters most here is speed. The corpus writes
 * `Treadmill easy run 6 km, speed = 7.0` with no unit at all. 7.0 km/h is a
 * brisk walk and 7.0 mph is a solid run, and neighbouring cells give paces
 * consistent with either reading depending on the day. So the number is
 * preserved with `speedUnit: null` and an AMBIGUOUS_SPEED_UNIT warning, and no
 * conversion is ever attempted.
 */

export interface CardioMetrics {
  distanceKm: number | null;
  distanceOriginalValue: number | null;
  distanceOriginalUnit: string | null;
  durationSeconds: number | null;
  paceSecondsPerKm: number | null;
  splitSecondsPer500m: number | null;
  speedValue: number | null;
  speedUnit: "kmh" | "mph" | null;
  calories: number | null;
  avgHeartRateBpm: number | null;
  cadenceSpm: number | null;
  elevationGainM: number | null;
  /** `46 floors`, `11 floors` — recorded as-is, never turned into metres. */
  floors: number | null;
  steps: number | null;
  /** `vest 9 kg` — carried load, not a lifted load. */
  externalLoadKg: number | null;
  warnings: ParseWarning[];
}

function empty(): CardioMetrics {
  return {
    distanceKm: null,
    distanceOriginalValue: null,
    distanceOriginalUnit: null,
    durationSeconds: null,
    paceSecondsPerKm: null,
    splitSecondsPer500m: null,
    speedValue: null,
    speedUnit: null,
    calories: null,
    avgHeartRateBpm: null,
    cadenceSpm: null,
    elevationGainM: null,
    floors: null,
    steps: null,
    externalLoadKg: null,
    warnings: [],
  };
}

/** `6.2 km`, `4.33km`, `1000m`, `2.76 miles`, `12.5 meters`. */
const DISTANCE = /(\d+(?:\.\d+)?)\s*(kilometers?|kilometres?|km|meters?|metres?|m|miles?|mi)\b/i;
/** `2:14.9/500m` — the rowing and ski convention. */
const SPLIT_500 = /(\d{1,2}:\d{2}(?:\.\d+)?)\s*\/\s*500\s*m/i;
/** `6:49 per km`, `pace 1:54`, `6:51 per km`. */
const PACE = /(?:pace\s*[:=]?\s*)?(\d{1,2}:\d{2}(?:\.\d+)?)\s*(?:per|\/)\s*km/i;
const PACE_LABELLED = /\bpace\s*[:=]?\s*(\d{1,2}:\d{2}(?:\.\d+)?)/i;
/** `speed = 7.0`, `speed = 5.7`. Deliberately captures no unit. */
const SPEED = /\bspeed\s*[:=]\s*(\d+(?:\.\d+)?)\s*(km\/?h|kmh|mph)?/i;
/** `120 kkal total`, `10 kkal row`, `15 kkal bike`. `kkal` is a misspelling. */
const CALORIES = /(\d+(?:\.\d+)?)\s*k?kals?\b/i;
/** `fc promedio - 152lpm`, `Frec. cardiaca - 148`, `fc promedio- 147lpm`. */
const HEART_RATE = /(?:fc\s+promedio|frec\.?\s*cardiaca)\s*[-:=]?\s*(\d{2,3})/i;
/** `cadencia - 159`, `cadencia promedio - 167`, `cadencia promedio = 165`. */
const CADENCE = /cadencia(?:\s+promedio)?\s*[-:=]?\s*(\d{2,3})/i;
/** `1142m - altitude gain`. */
const ELEVATION = /(\d+(?:\.\d+)?)\s*m\s*-\s*altitude\s+gain/i;
/** `46 floors`, `11 floors`. */
const FLOORS = /(\d+)\s*floors?\b/i;
/** `19+K steps` — a non-numeric quantity. */
const STEPS = /(\d+)\s*(\+?K?)\s*steps\b/i;
/** `vest 9 kg`, `in vest = 9 kg`, `(vest 9 kg)`. */
const VEST = /vest\s*[=:]?\s*(\d+(?:\.\d+)?)\s*kg/i;

function distanceUnitOf(raw: string): "km" | "m" | "mi" {
  const u = raw.toLowerCase();
  if (/^mi|^mile/.test(u)) return "mi";
  if (/^(m|meter|metre)/.test(u) && !/^(km|kilo)/.test(u)) return "m";
  return "km";
}

export function parseCardioLine(line: string): CardioMetrics {
  const out = empty();
  const text = line.trim();

  const split500 = SPLIT_500.exec(text);
  if (split500?.[1]) out.splitSecondsPer500m = clockToSeconds(split500[1]);

  const distance = DISTANCE.exec(text);
  if (distance?.[1] && distance[2]) {
    const value = parseDecimal(distance[1]);
    const unit = distanceUnitOf(distance[2]);
    if (value !== null) {
      const converted = toKilometres(value, unit);
      out.distanceKm = converted.value;
      out.distanceOriginalValue = value;
      out.distanceOriginalUnit = unit;
    }
  }

  const pace = PACE.exec(text) ?? PACE_LABELLED.exec(text);
  if (pace?.[1]) out.paceSecondsPerKm = clockToSeconds(pace[1]);

  const speed = SPEED.exec(text);
  if (speed?.[1]) {
    out.speedValue = parseDecimal(speed[1]);
    if (speed[2]) {
      out.speedUnit = /mph/i.test(speed[2]) ? "mph" : "kmh";
    } else {
      // Acceptance criterion 15: preserve the number, assert no unit.
      out.speedUnit = null;
      out.warnings.push(
        warn(
          "AMBIGUOUS_SPEED_UNIT",
          `"${speed[0].trim()}" states no unit; the value is preserved but not converted.`,
          speed[0],
        ),
      );
    }
  }

  const calories = CALORIES.exec(text);
  if (calories?.[1]) out.calories = parseDecimal(calories[1]);

  const hr = HEART_RATE.exec(text);
  if (hr?.[1]) {
    out.avgHeartRateBpm = Number(hr[1]);
    out.warnings.push(
      warn("SPANISH_METRIC_LABEL", `Spanish heart-rate label read as avg HR.`, hr[0]),
    );
  }

  const cadence = CADENCE.exec(text);
  if (cadence?.[1]) {
    out.cadenceSpm = Number(cadence[1]);
    out.warnings.push(
      warn("SPANISH_METRIC_LABEL", `Spanish cadence label read as cadence.`, cadence[0]),
    );
  }

  const elevation = ELEVATION.exec(text);
  if (elevation?.[1]) out.elevationGainM = parseDecimal(elevation[1]);

  const floors = FLOORS.exec(text);
  if (floors?.[1]) out.floors = Number(floors[1]);

  const steps = STEPS.exec(text);
  if (steps?.[1]) {
    // `19+K steps` means "more than 19 thousand", which is not a number.
    if (steps[2]) {
      out.warnings.push(
        warn(
          "NON_NUMERIC_QUANTITY",
          `"${steps[0].trim()}" is an approximate step count and is stored as text.`,
          steps[0],
        ),
      );
    } else {
      out.steps = Number(steps[1]);
    }
  }

  const vest = VEST.exec(text);
  if (vest?.[1]) out.externalLoadKg = parseDecimal(vest[1]);

  // Duration last: a bare `30:26` is a duration only when nothing else claimed
  // it as a pace or a split.
  out.durationSeconds = parseDurationPhrase(text);
  if (out.durationSeconds === null) {
    const bare = /(?:^|[,(\s])(\d{1,2}:\d{2}(?:\.\d+)?)(?![\s]*(?:per|\/))/.exec(text);
    if (bare?.[1] && clockToSeconds(bare[1]) !== out.paceSecondsPerKm) {
      out.durationSeconds = clockToSeconds(bare[1]);
    }
  }

  return out;
}

/** `Fast intervals pace: 4:52 - 4:32` / `4:09 - 4:11 - 4:11 - 4:15` */
const INTERVAL_PACE_LIST = /^fast\s+intervals?\s+pace\s*[:=]\s*(.+)$/i;

/**
 * Extracts discrete intervals, which the brief requires for Norwegian 4x4
 * sessions and rowing splits. Only two shapes in this corpus carry genuine
 * per-interval data; everything else is a single steady effort and is left on
 * the activity rather than fabricated into intervals.
 */
export function extractIntervals(lines: readonly string[]): {
  intervals: CardioIntervalSeed[];
  consumed: string[];
} {
  const intervals: CardioIntervalSeed[] = [];
  const consumed: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    const paceList = INTERVAL_PACE_LIST.exec(line);
    if (paceList?.[1]) {
      const paces = paceList[1].split(/\s*-\s*/).map((p) => clockToSeconds(p.trim()));
      paces.forEach((pace, i) => {
        if (pace === null) return;
        intervals.push({
          intervalIndex: intervals.length + 1,
          intervalType: "work",
          paceSecondsPerKm: pace,
          durationSeconds: null,
          distanceKm: null,
          splitSecondsPer500m: null,
          originalText: line,
          notes: `Interval ${i + 1} of ${paces.length}`,
        });
      });
      consumed.push(raw);
      continue;
    }

    // `Row machine: 1000m, 4:31, 2:14.9/500m` / `Ski machine, 1000m, pace 1:54`
    const m = parseCardioLine(line);
    if (m.splitSecondsPer500m !== null && m.distanceKm !== null) {
      intervals.push({
        intervalIndex: intervals.length + 1,
        intervalType: "split",
        paceSecondsPerKm: m.paceSecondsPerKm,
        durationSeconds: m.durationSeconds,
        distanceKm: m.distanceKm,
        splitSecondsPer500m: m.splitSecondsPer500m,
        originalText: line,
        notes: null,
      });
      consumed.push(raw);
    }
  }

  return { intervals, consumed };
}

export interface CardioIntervalSeed {
  intervalIndex: number;
  intervalType: "work" | "split";
  paceSecondsPerKm: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  splitSecondsPer500m: number | null;
  originalText: string;
  notes: string | null;
}

/** True when the line carried at least one usable metric. */
export function hasAnyMetric(m: CardioMetrics): boolean {
  return (
    m.distanceKm !== null ||
    m.durationSeconds !== null ||
    m.paceSecondsPerKm !== null ||
    m.splitSecondsPer500m !== null ||
    m.speedValue !== null ||
    m.calories !== null ||
    m.avgHeartRateBpm !== null ||
    m.cadenceSpm !== null ||
    m.elevationGainM !== null ||
    m.floors !== null ||
    m.steps !== null
  );
}

/** Fields a follow-on metric line may fill in. `warnings` is concatenated. */
const MERGEABLE = [
  "distanceKm",
  "distanceOriginalValue",
  "distanceOriginalUnit",
  "durationSeconds",
  "paceSecondsPerKm",
  "splitSecondsPer500m",
  "speedValue",
  "speedUnit",
  "calories",
  "avgHeartRateBpm",
  "cadenceSpm",
  "elevationGainM",
  "floors",
  "steps",
  "externalLoadKg",
] as const satisfies readonly (keyof CardioMetrics)[];

/**
 * Folds a metric line's values into the activity it belongs to. Only fills
 * gaps: a value already read from the activity's own line wins, so
 * `cadencia - 159` cannot overwrite a cadence the headline already stated.
 */
export function mergeMetrics(base: CardioMetrics, extra: CardioMetrics): CardioMetrics {
  const out: CardioMetrics = { ...base, warnings: [...base.warnings, ...extra.warnings] };
  for (const key of MERGEABLE) {
    if (out[key] === null && extra[key] !== null) {
      Object.assign(out, { [key]: extra[key] });
    }
  }
  return out;
}
