import {
  clockToSeconds,
  parseDecimal,
  warn,
  type BenchmarkResultDraft,
  type BenchmarkSplitDraft,
  type ParseWarning,
} from "@training/domain";
import { parseCardioLine } from "./cardio.js";

/**
 * Benchmark parsing: Murph and its partial variants, and Cindy.
 *
 * The hard part is timing semantics. The Full Murph cell (R24C8) records
 * CUMULATIVE elapsed times, and shifts its reference point mid-cell:
 *
 *   run 1 - 8:57                                  a duration
 *   100 pull ups (10:41 finished after started them)   from the pull-up start
 *   200 push ups (29:15 after the start of pull ups)   from the pull-up start
 *   300 squats (finished at 39:56)                     from... the same start
 *   run 2 (5:35, cadencia promedio - 160)              a pace, not a time
 *
 * Subtracting across those to synthesise per-movement splits produces
 * plausible numbers that are wrong. So `elapsedSeconds` holds what was
 * written, `referenceFrame` records what it was measured from, `splitSeconds`
 * stays null unless the subtraction is unambiguous, and the whole result
 * carries a CUMULATIVE_TIMING warning.
 */

/** `Full Murph (vest, total time - 58:52)`, `Murph preperation (vest 9 kg):` */
const MURPH_OPENER = /^(?:(full|half|\d+%)\s+)?murph\b([^:]*)/i;
/** `Cindy 11 rounds:`, `12 rounds cindy bodyweight:`, `10 rounds Cindy (...)` */
const CINDY_OPENER = /^(?:(\d+)\s*rounds?\s+)?cindy\b\s*(?:(\d+)\s*rounds?)?/i;
/** `Half murph (21:13):`, `60% murph (23:11):`, `12 rounds cindy (19:31):` */
const PAREN_TIME = /\((\d{1,2}:\d{2}(?:\.\d+)?)\)/;
/** `total time - 58:52`, `Total time: 38:11` */
const TOTAL_TIME = /total\s+time\s*[-:=]\s*(\d{1,3}:\d{2}(?:\.\d+)?)/i;
/** `vest 9 kg`, `(vest, ...)` with no number. */
const VEST_KG = /vest[,\s]*(?:=\s*)?(\d+(?:\.\d+)?)\s*kg/i;
const VEST_MENTION = /\bvest\b/i;
const NO_VEST = /\bno\s+vest\b/i;

/** `(29:15 after the start of pull ups)` / `(finished at 39:56)` / `(10:41 finished after started them)` */
const CUMULATIVE_MARKER = /\b(?:after\s+the\s+start|after\s+started|finished\s+at|finished\s+after)\b/i;
/** `started doing sets of 4 at 30, sets of 3 at 38` */
const PARTITION = /\bstarted\s+doing\s+sets[^)]*/i;

export interface BenchmarkParse {
  draft: BenchmarkResultDraft;
  /** Lines this parser consumed. */
  consumed: string[];
  warnings: ParseWarning[];
}

function slugFor(qualifier: string | undefined, isCindy: boolean): {
  slug: string;
  variant: string | null;
} {
  if (isCindy) return { slug: "cindy", variant: null };
  if (!qualifier) return { slug: "murph", variant: null };
  const q = qualifier.toLowerCase();
  if (q === "full") return { slug: "murph", variant: null };
  if (q === "half") return { slug: "half-murph", variant: "half murph" };
  // `60% murph`, `75% murph` — a partial attempt of the full benchmark.
  return { slug: "murph", variant: `${q} murph` };
}

/**
 * Parses a benchmark session unit.
 *
 * `lines` is the whole unit as produced by the splitter, with the opener
 * first. Returns null when the unit does not actually open a benchmark.
 */
export function parseBenchmarkUnit(lines: readonly string[]): BenchmarkParse | null {
  const first = lines[0]?.trim() ?? "";
  const murph = MURPH_OPENER.exec(first);
  const cindy = murph ? null : CINDY_OPENER.exec(first);
  if (!murph && !cindy) return null;

  const warnings: ParseWarning[] = [];
  const { slug, variant } = slugFor(murph?.[1], Boolean(cindy));

  // --- header facts --------------------------------------------------------
  const joined = lines.join("\n");
  const totalMatch = TOTAL_TIME.exec(joined);
  let totalSeconds = totalMatch?.[1] ? clockToSeconds(totalMatch[1]) : null;

  // `Half murph (21:13):` puts the score in parentheses on the opener.
  if (totalSeconds === null) {
    const paren = PAREN_TIME.exec(first);
    if (paren?.[1]) totalSeconds = clockToSeconds(paren[1]);
  }

  const vest = VEST_KG.exec(joined);
  const vestKg = vest?.[1] ? parseDecimal(vest[1]) : null;
  if (vestKg === null && VEST_MENTION.test(first) && !NO_VEST.test(first)) {
    warnings.push(
      warn(
        "PARTIAL_PARSE",
        `A vest was worn but its weight is not stated on this line.`,
        first,
      ),
    );
  }

  const rounds = cindy?.[1] ?? cindy?.[2];
  const roundsCompleted = rounds ? Number(rounds) : null;

  // --- splits --------------------------------------------------------------
  const splits: BenchmarkSplitDraft[] = [];
  let sawCumulative = false;
  const partitionNotes: string[] = [];

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (TOTAL_TIME.test(line)) continue;

    const isCumulative = CUMULATIVE_MARKER.test(line);
    if (isCumulative) sawCumulative = true;

    const partition = PARTITION.exec(line);
    if (partition) partitionNotes.push(partition[0].trim());

    // A movement line: `100 pull ups (10:41 ...)`, `300 squats (...)`,
    // `run 1 - 8:57 (5:40, ...)`, `1.54 km run (5:51, fc promedio- 157lpm)`.
    const reps = /^(\d+)\s+(?:[a-z])/i.exec(line);
    const metrics = parseCardioLine(line);
    const time = firstClock(line);

    const isMovement = reps !== null || metrics.distanceKm !== null || time !== null;
    if (!isMovement) continue;

    splits.push({
      splitOrder: splits.length + 1,
      label: labelOf(line),
      reps: reps?.[1] ? Number(reps[1]) : null,
      distanceKm: metrics.distanceKm,
      elapsedSeconds: time,
      // Deliberately null: see the file comment. The reference frames in this
      // corpus are mixed, so a derived split would be a fabricated number.
      splitSeconds: null,
      isCumulative,
      referenceFrame: isCumulative ? "movement_block_start" : "segment",
      paceSecondsPerKm: metrics.paceSecondsPerKm,
      heartRateBpm: metrics.avgHeartRateBpm,
      cadenceSpm: metrics.cadenceSpm,
      notes: null,
      originalText: line,
    });
  }

  if (sawCumulative) {
    warnings.push(
      warn(
        "CUMULATIVE_TIMING",
        "Split times are cumulative elapsed times measured from the start of the movement block, not per-movement durations. splitSeconds is left null rather than derived across mixed reference frames.",
        lines.find((l) => CUMULATIVE_MARKER.test(l)) ?? joined,
      ),
    );
  }

  if (totalSeconds === null) {
    warnings.push(
      warn("BENCHMARK_SCORE_MISSING", `No total time recorded for this ${slug}.`, first),
    );
  }

  const draft: BenchmarkResultDraft = {
    definitionSlug: slug,
    variantLabel: variant,
    scoring: "time",
    totalSeconds,
    roundsCompleted,
    score: null,
    vestKg,
    asPrescribed: null,
    partitionStrategy: partitionNotes.length > 0 ? partitionNotes.join(" | ") : null,
    splits,
    notes: null,
    originalText: joined,
  };

  return { draft, consumed: [...lines], warnings };
}

/** The first clock value on a line, which is that segment's recorded time. */
function firstClock(line: string): number | null {
  const m = /(\d{1,3}:\d{2}(?:\.\d+)?)/.exec(line);
  return m?.[1] ? clockToSeconds(m[1]) : null;
}

/** A short human label: the text before the first parenthesis or time. */
function labelOf(line: string): string {
  const cut = line.split("(")[0]!.trim();
  return (cut.length > 0 ? cut : line).replace(/\s*[-–]\s*\d.*$/, "").trim() || line;
}
