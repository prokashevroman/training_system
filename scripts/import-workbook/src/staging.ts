import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Reads `data/staging/cells.jsonl`, the handoff between the Python extractor
 * and the TypeScript pipeline.
 *
 * The schema is enforced on read rather than trusted: the two sides are
 * separate programs in separate languages, and a silently changed field name
 * would otherwise surface as a wrong date somewhere deep in the parser.
 */

export const STAGING_PATH = fileURLToPath(
  new URL("../../../data/staging/cells.jsonl", import.meta.url),
);

export const StagedCellSchema = z.object({
  sheet: z.string().min(1),
  row: z.number().int().positive(),
  col: z.number().int().positive(),
  day_index: z.number().int().min(1).max(7),
  week_label: z.string().min(1),
  week_number: z.number().int().positive(),
  local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  raw_text: z.string().min(1),
  raw_text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  workbook_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type StagedCell = z.infer<typeof StagedCellSchema>;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadStagedCells(path: string = STAGING_PATH): StagedCell[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `No staging file at ${path}. Run \`pnpm import:extract\` first — it turns the workbook into data/staging/cells.jsonl.`,
    );
  }

  const cells: StagedCell[] = [];
  raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .forEach((line, i) => {
      const parsed = StagedCellSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(
          `data/staging/cells.jsonl line ${i + 1} does not match the staging schema: ${parsed.error.message}`,
        );
      }
      // The extractor writes this checksum; recomputing it here means a hand
      // edit to the staging file cannot slip an altered cell into the import.
      const expected = sha256(parsed.data.raw_text);
      if (expected !== parsed.data.raw_text_sha256) {
        throw new Error(
          `data/staging/cells.jsonl line ${i + 1} (R${parsed.data.row}C${parsed.data.col}): raw_text does not match its recorded checksum. Re-run \`pnpm import:extract\`.`,
        );
      }
      cells.push(parsed.data);
    });

  return cells;
}
