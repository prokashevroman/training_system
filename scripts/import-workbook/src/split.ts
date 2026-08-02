import { warn, type ParseWarning } from "@training/domain";
import { ATTACHING_KINDS, classifyLine, type LineKind } from "./classify.js";

/**
 * Cell text -> session units.
 *
 * Blank-line blocks are the primary signal (269 across the corpus), but a
 * block is not a session. Four ordered adjustments turn blocks into sessions,
 * each of which exists because of specific real cells:
 *
 *  1. mergeHeaderBlocks     — `Murph preperation (vest 9 kg):` sits alone in
 *                             its own block, with the run/Cindy/run body in
 *                             the next one. Without this the benchmark splits
 *                             into two sessions.
 *  2. extractCommute        — `Bike to & from work` is its own session even
 *                             when it shares a block with strength work
 *                             (R25C4 has no blank line before it).
 *  3. absorbBenchmarkBody   — the Full Murph cell (R24C8) is three blocks:
 *                             the header, the splits, and the quality notes.
 *                             All three are one benchmark session.
 *  4. mergeAdjacentSameKind — R17C3's `Back squat` and `Pull-ups` blocks are
 *                             one gym session, not two.
 *
 * Anything still ambiguous stays merged and is flagged POSSIBLE_MULTI_SESSION
 * rather than being split on a guess: modality is preserved per activity, so
 * splitting later is a data edit, while an unrecoverable bad split is not.
 */

export interface SessionUnit {
  /** 1-based position within the cell; feeds the client_request_key ordinal. */
  ordinal: number;
  kind: LineKind;
  lines: string[];
  text: string;
  warnings: ParseWarning[];
}

export interface SplitResult {
  units: SessionUnit[];
  /** Blank-line blocks seen before any merging, for reconciliation accounting. */
  blockCount: number;
  warnings: ParseWarning[];
}

interface Block {
  lines: string[];
  kind: LineKind;
}

/** Kinds that open a session of their own and are never absorbed. */
const OPENER_KINDS: ReadonlySet<LineKind> = new Set<LineKind>(["benchmark", "commute"]);

function isCommuteLine(line: string): boolean {
  return classifyLine(line).kind === "commute";
}

/** A block's kind is that of its first line that can carry a session. */
function blockKind(lines: string[]): LineKind {
  for (const line of lines) {
    const k = classifyLine(line).kind;
    if (!ATTACHING_KINDS.has(k)) return k;
  }
  return "note";
}

function toBlocks(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    )
    .filter((lines) => lines.length > 0);
}

/**
 * A block that is a single line ending in `:` is a header for the block that
 * follows it. `Murph preperation (vest 9 kg):`, `5 rounds of:`,
 * `4 rounds (all with 2 DB 10 kg each):`.
 */
function mergeHeaderBlocks(blocks: string[][]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const isHeaderOnly = block.length === 1 && block[0]!.endsWith(":");
    const next = blocks[i + 1];
    if (isHeaderOnly && next) {
      out.push([...block, ...next]);
      i += 1; // the following block has been consumed
    } else {
      out.push(block);
    }
  }
  return out;
}

/**
 * Pulls commute lines out of every block and collapses them into one commute
 * unit, positioned where the first commute line appeared. A cell never yields
 * two commute sessions: `Bike to & from work` + `(+ extra biking)` is one ride.
 */
function extractCommute(blocks: string[][]): { blocks: string[][]; commute: string[] | null } {
  const commute: string[] = [];
  const remaining: string[][] = [];
  let insertAt = -1;

  for (const block of blocks) {
    const kept = block.filter((line) => {
      if (!isCommuteLine(line)) return true;
      if (insertAt < 0) insertAt = remaining.length;
      commute.push(line);
      return false;
    });
    if (kept.length > 0) remaining.push(kept);
  }

  if (commute.length === 0) return { blocks, commute: null };

  const at = insertAt < 0 ? remaining.length : Math.min(insertAt, remaining.length);
  // Splice a placeholder so ordering is preserved; the caller rebuilds units.
  return {
    blocks: [...remaining.slice(0, at), COMMUTE_PLACEHOLDER, ...remaining.slice(at)],
    commute,
  };
}

/** Identity-compared marker for where the commute unit belongs. */
const COMMUTE_PLACEHOLDER: string[] = [];

/**
 * A benchmark block absorbs the blocks after it until something opens a new
 * session. This keeps the Full Murph header, its splits, and its trailing
 * quality notes as one session.
 */
function absorbBenchmarkBody(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    // Absorb everything until something opens a new session. A benchmark is a
    // scripted sequence, so its parts legitimately look like other modalities:
    // the Full Murph body opens with `run 1 - 8:57`, which classifies as
    // running, and its trailing note mentions squats. Only a new benchmark or
    // a commute genuinely starts a different session.
    if (prev?.kind === "benchmark" && !OPENER_KINDS.has(block.kind)) {
      prev.lines.push(...block.lines);
      continue;
    }
    out.push(block);
  }
  return out;
}

/** `Back squat` + `Pull-ups` in separate blocks are one gym session. */
function mergeAdjacentSameKind(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === block.kind && !OPENER_KINDS.has(block.kind)) {
      prev.lines.push(...block.lines);
      continue;
    }
    out.push(block);
  }
  return out;
}

export function splitIntoSessionUnits(normalizedText: string): SplitResult {
  const rawBlocks = toBlocks(normalizedText);
  const blockCount = rawBlocks.length;
  const warnings: ParseWarning[] = [];

  const merged = mergeHeaderBlocks(rawBlocks);
  const { blocks: withPlaceholder, commute } = extractCommute(merged);

  // Turn the block arrays into classified Blocks, keeping the commute slot.
  const classified: Block[] = withPlaceholder.map((lines) =>
    lines === COMMUTE_PLACEHOLDER
      ? { lines: commute ?? [], kind: "commute" as LineKind }
      : { lines: [...lines], kind: blockKind(lines) },
  );

  const units = mergeAdjacentSameKind(absorbBenchmarkBody(classified))
    .filter((b) => b.lines.length > 0)
    .map((b, i): SessionUnit => {
      const unitWarnings: ParseWarning[] = [];

      // Flag a unit that holds several session-carrying kinds. It was kept
      // together deliberately, but a human should confirm that was right.
      const kinds = new Set(
        b.lines.map((l) => classifyLine(l).kind).filter((k) => !ATTACHING_KINDS.has(k)),
      );
      if (b.kind !== "benchmark" && b.kind !== "circuit" && kinds.size > 1) {
        unitWarnings.push(
          warn(
            "POSSIBLE_MULTI_SESSION",
            `This session holds ${kinds.size} activity kinds (${[...kinds].join(", ")}) that may be separate sessions.`,
            b.lines.join("\n"),
          ),
        );
      }

      return {
        ordinal: i + 1,
        kind: b.kind,
        lines: b.lines,
        text: b.lines.join("\n"),
        warnings: unitWarnings,
      };
    });

  return { units, blockCount, warnings };
}
