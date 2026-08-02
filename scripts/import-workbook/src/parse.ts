import {
  cellLocator,
  importRequestKey,
  resolveExerciseSlug,
  warn,
  type ActivityDraft,
  type CardioIntervalDraft,
  type Modality,
  type ParseResult,
  type ParseWarning,
  type SessionDraft,
  type StrengthSetDraft,
} from "@training/domain";
import { ATTACHING_KINDS, classifyLine, type LineKind } from "./classify.js";
import { normalizeCellText } from "./normalize.js";
import {
  extractIntervals,
  hasAnyMetric,
  mergeMetrics,
  parseCardioLine,
  type CardioMetrics,
} from "./parsers/cardio.js";
import { parseBenchmarkUnit } from "./parsers/benchmark.js";
import { parseCircuitUnit } from "./parsers/circuit.js";
import { expandSets, parseStrengthLine } from "./parsers/strength.js";
import { splitIntoSessionUnits, type SessionUnit } from "./split.js";

export const PARSER_VERSION = "0.1.0";

export interface CellInput {
  sheet: string;
  row: number;
  col: number;
  localDate: string;
  rawText: string;
}

/**
 * What happened to one source line. Every non-empty line gets exactly one
 * disposition, which is what lets the reconciliation report assert coverage
 * rather than estimate it (acceptance criterion 9).
 */
export type Disposition = "structured" | "metric" | "note" | "unconsumed";

export interface LineOutcome {
  line: string;
  disposition: Disposition;
  /** Which parser claimed it, for debugging a bad parse. */
  via: string;
}

export interface CellParseResult extends ParseResult {
  locator: string;
  outcomes: LineOutcome[];
}

interface ActivityGroup {
  kind: LineKind;
  lines: string[];
}

/** Splits a unit's lines into runs of one modality; notes/metrics attach. */
function groupIntoActivities(lines: readonly string[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const line of lines) {
    const kind = classifyLine(line).kind;
    const current = groups[groups.length - 1];
    if (ATTACHING_KINDS.has(kind)) {
      if (current) current.lines.push(line);
      else groups.push({ kind: "note", lines: [line] });
      continue;
    }
    if (current && current.kind === kind) current.lines.push(line);
    else groups.push({ kind, lines: [line] });
  }
  return groups;
}

const MODALITY_FOR: Readonly<Partial<Record<LineKind, Modality>>> = {
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
  commute: "cycling",
  benchmark: "hybrid_conditioning",
  circuit: "hybrid_conditioning",
};

function metricsToActivityFields(m: CardioMetrics) {
  const details: Record<string, unknown> = {};
  if (m.floors !== null) details.floors = m.floors;
  if (m.steps !== null) details.steps = m.steps;
  if (m.speedValue !== null) {
    // Recorded with its unit explicitly null when the source stated none.
    details.speed = { value: m.speedValue, unit: m.speedUnit };
  }
  if (m.splitSecondsPer500m !== null) details.splitSecondsPer500m = m.splitSecondsPer500m;
  if (m.distanceOriginalUnit && m.distanceOriginalUnit !== "km") {
    details.originalDistance = { value: m.distanceOriginalValue, unit: m.distanceOriginalUnit };
  }
  return {
    durationSeconds: m.durationSeconds,
    distanceKm: m.distanceKm,
    calories: m.calories,
    avgHeartRateBpm: m.avgHeartRateBpm,
    cadenceSpm: m.cadenceSpm,
    elevationGainM: m.elevationGainM,
    externalLoadKg: m.externalLoadKg,
    details,
  };
}

function buildActivity(
  group: ActivityGroup,
  sequence: number,
  outcomes: LineOutcome[],
  warnings: ParseWarning[],
): ActivityDraft | null {
  const modality = MODALITY_FOR[group.kind] ?? "other";
  const first = group.lines[0]!;
  const classification = classifyLine(first);
  const text = group.lines.join("\n");

  const base = {
    sequence,
    modality,
    subtype: null as string | null,
    objective: classification.objective,
    intensity: "unknown" as const,
    durationSeconds: null as number | null,
    distanceKm: null as number | null,
    calories: null as number | null,
    avgHeartRateBpm: null as number | null,
    maxHeartRateBpm: null as number | null,
    cadenceSpm: null as number | null,
    elevationGainM: null as number | null,
    avgPowerWatts: null as number | null,
    externalLoadKg: null as number | null,
    details: {} as Record<string, unknown>,
    notes: null as string | null,
    originalText: text,
    strengthSets: [] as StrengthSetDraft[],
    cardioIntervals: [] as CardioIntervalDraft[],
    circuit: null,
    benchmark: null,
  };

  // --- benchmark -----------------------------------------------------------
  if (group.kind === "benchmark") {
    const parsed = parseBenchmarkUnit(group.lines);
    if (parsed) {
      warnings.push(...parsed.warnings);
      for (const line of group.lines) {
        const isSplit = parsed.draft.splits.some((s) => s.originalText === line.trim());
        outcomes.push({
          line,
          disposition: isSplit ? "structured" : line === first ? "structured" : "note",
          via: "benchmark",
        });
      }
      return { ...base, objective: "race_specific", benchmark: parsed.draft };
    }
  }

  // --- circuit -------------------------------------------------------------
  if (group.kind === "circuit") {
    const parsed = parseCircuitUnit(group.lines);
    if (parsed) {
      warnings.push(...parsed.warnings);
      for (const line of group.lines) {
        const isMovement = parsed.draft.movements.some((m) => m.originalText === line.trim());
        outcomes.push({
          line,
          disposition: isMovement || line === first ? "structured" : "note",
          via: "circuit",
        });
      }
      return { ...base, objective: "hybrid_conditioning", circuit: parsed.draft };
    }
  }

  // --- strength ------------------------------------------------------------
  if (group.kind === "strength") {
    const sets: StrengthSetDraft[] = [];
    let index = 1;
    // R12C2 writes `Bench press:` on its own line and the sets underneath it.
    // The name carries forward until another line supplies one.
    let pendingName: string | null = null;
    for (const line of group.lines) {
      const header = /^([A-Za-z][A-Za-z\s.'-]*)\s*:\s*$/.exec(line.trim());
      if (header?.[1]) {
        pendingName = header[1].trim();
        outcomes.push({ line, disposition: "structured", via: "strength:exercise-header" });
        continue;
      }
      const parsed = parseStrengthLine(line);
      if (!parsed) {
        outcomes.push({ line, disposition: "unconsumed", via: "strength" });
        warnings.push(
          warn("UNPARSED_LINE", `No strength matcher claimed this line.`, line, "warning"),
        );
        continue;
      }
      warnings.push(...parsed.warnings);
      const name = parsed.exerciseText || pendingName || "";
      const slug = name ? resolveExerciseSlug(name) : null;
      if (name && slug === null) {
        warnings.push(
          warn(
            "UNRESOLVED_EXERCISE_ALIAS",
            `No alias resolves "${name}" to a canonical exercise.`,
            line,
          ),
        );
      }
      for (const s of expandSets(parsed, index)) {
        sets.push({
          setIndex: s.setIndex,
          exercise: {
            rawText: name || line,
            slug,
            apparatus: null,
            confidence: slug ? parsed.confidence : 0,
          },
          setType: "working",
          reps: s.reps,
          loadValue: s.load.value,
          loadUnit: s.load.unit,
          loadKg: s.load.kg,
          loadScope: s.load.scope,
          side: null,
          rir: null,
          rpe: null,
          tempo: null,
          restSeconds: null,
          holdSeconds: s.holdSeconds,
          completed: true,
          notes: null,
          originalText: line,
        });
        index = s.setIndex + 1;
      }
      outcomes.push({ line, disposition: "structured", via: `strength:${parsed.matcher}` });
    }
    if (sets.length === 0) return null;
    return { ...base, strengthSets: sets };
  }

  // --- commute -------------------------------------------------------------
  if (group.kind === "commute") {
    let metrics = parseCardioLine(text);
    for (const line of group.lines) {
      outcomes.push({ line, disposition: "structured", via: "commute" });
    }
    warnings.push(...metrics.warnings);
    return {
      ...base,
      objective: "commute",
      subtype: "commute",
      ...metricsToActivityFields(metrics),
    };
  }

  // --- everything else is metric-bearing cardio / recovery -----------------
  let metrics = parseCardioLine(first);
  outcomes.push({ line: first, disposition: "structured", via: `activity:${group.kind}` });
  for (const line of group.lines.slice(1)) {
    const extra = parseCardioLine(line);
    if (hasAnyMetric(extra)) {
      metrics = mergeMetrics(metrics, extra);
      outcomes.push({ line, disposition: "metric", via: `metric:${group.kind}` });
    } else {
      outcomes.push({ line, disposition: "note", via: `note:${group.kind}` });
    }
  }
  warnings.push(...metrics.warnings);

  const noteLines = outcomes
    .filter((o) => o.disposition === "note" && group.lines.includes(o.line))
    .map((o) => o.line);

  // Norwegian interval lists and rowing splits carry genuine per-interval data.
  const { intervals } = extractIntervals(group.lines);
  const cardioIntervals: CardioIntervalDraft[] = intervals.map((iv) => ({
    intervalIndex: iv.intervalIndex,
    intervalType: iv.intervalType,
    durationSeconds: iv.durationSeconds,
    restSeconds: null,
    distanceKm: iv.distanceKm,
    paceSecondsPerKm: iv.paceSecondsPerKm,
    splitSecondsPer500m: iv.splitSecondsPer500m,
    speedValue: null,
    speedUnit: null,
    heartRateBpm: null,
    powerWatts: null,
    cadenceSpm: null,
    calories: null,
    notes: iv.notes,
    originalText: iv.originalText,
  }));

  return {
    ...base,
    ...metricsToActivityFields(metrics),
    cardioIntervals,
    notes: noteLines.length > 0 ? noteLines.join("\n") : null,
  };
}

function titleFor(unit: SessionUnit): string {
  const first = unit.lines[0]!.replace(/[:.]\s*$/, "").trim();
  return first.length > 80 ? `${first.slice(0, 77)}...` : first;
}

/** Parses one workbook cell into zero or more session drafts. */
export function parseCell(input: CellInput): CellParseResult {
  const normalized = normalizeCellText(input.rawText);
  const { units } = splitIntoSessionUnits(normalized.text);

  const sessions: SessionDraft[] = [];
  const warnings: ParseWarning[] = [];
  const outcomes: LineOutcome[] = [];

  for (const unit of units) {
    warnings.push(...unit.warnings);
    const activities: ActivityDraft[] = [];
    let sequence = 1;

    // A benchmark or a circuit is one scripted whole. Sub-grouping it by
    // modality would hand its parser only the opener — the Full Murph body
    // classifies as running, so the splits would be torn off and lost.
    const groups: ActivityGroup[] =
      unit.kind === "benchmark" || unit.kind === "circuit"
        ? [{ kind: unit.kind, lines: [...unit.lines] }]
        : groupIntoActivities(unit.lines);

    for (const group of groups) {
      const activity = buildActivity(group, sequence, outcomes, warnings);
      if (activity) {
        activities.push(activity);
        sequence += 1;
      }
    }

    if (activities.length === 0) {
      // Nothing structured survived; the lines are already recorded as
      // unconsumed, and no empty session is created.
      continue;
    }

    sessions.push({
      localDate: input.localDate,
      startedAt: null,
      title: titleFor(unit),
      source: "excel_import",
      rawText: unit.text,
      transcript: null,
      notes: null,
      durationSeconds: null,
      sessionRpe: null,
      status: "completed",
      clientRequestKey: importRequestKey(input.sheet, input.row, input.col, unit.ordinal),
      activities,
      tags: [],
    });
  }

  const consumedLines = outcomes.filter((o) => o.disposition !== "unconsumed").map((o) => o.line);
  const unconsumedLines = outcomes.filter((o) => o.disposition === "unconsumed").map((o) => o.line);

  return {
    locator: cellLocator(input.row, input.col),
    sessions,
    warnings,
    consumedLines,
    unconsumedLines,
    outcomes,
    parserVersion: PARSER_VERSION,
  };
}
