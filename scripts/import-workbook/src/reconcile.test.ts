import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reconcile, renderReport, renderReviewQueue } from "./reconcile.js";
import { STAGING_PATH, loadStagedCells } from "./staging.js";

/**
 * These tests run against the real staging file, which is produced by
 * `pnpm import:extract` from the gitignored workbook. On a fresh clone without
 * the workbook there is nothing to reconcile, so the suite skips rather than
 * failing on a machine that legitimately has no personal data on it.
 */
const hasStaging = existsSync(STAGING_PATH);
const suite = hasStaging ? describe : describe.skip;

suite("reconciliation over the whole corpus", () => {
  const cells = loadStagedCells();
  const report = reconcile(cells);

  // Acceptance criterion 4.
  it("reads exactly 170 staged cells", () => {
    expect(report.cellsDiscovered).toBe(170);
  });

  it("sees the 550 non-empty source lines the profile counted", () => {
    expect(report.sourceLines).toBe(550);
  });

  /**
   * ACCEPTANCE CRITERION 9, as an assertion rather than prose.
   *
   * Every non-empty source line must end up either consumed by a structured
   * record or explicitly listed as unconsumed. There is no third outcome and
   * no silent loss: the dispositions must partition the corpus exactly.
   */
  it("accounts for every source line exactly once", () => {
    expect(report.linesAccountedFor).toBe(report.sourceLines);

    const dispositionTotal = Object.values(report.dispositions).reduce((a, b) => a + b, 0);
    expect(dispositionTotal).toBe(report.sourceLines);

    const consumed = report.linesAccountedFor - (report.dispositions.unconsumed ?? 0);
    expect(consumed + report.unconsumedLines.length).toBe(report.sourceLines);
  });

  it("lists every unconsumed line verbatim with its cell locator", () => {
    expect(report.unconsumedLines.length).toBe(report.dispositions.unconsumed ?? 0);
    for (const u of report.unconsumedLines) {
      expect(u.locator).toMatch(/^R\d+C\d+$/);
      expect(u.line.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * A coverage floor, not a target. It exists so a refactor that quietly stops
   * parsing a whole modality fails here instead of shipping. If coverage
   * legitimately drops, this number should be lowered deliberately and the
   * unconsumed list read.
   */
  it("keeps structured coverage above 95% of source lines", () => {
    const consumed = report.linesAccountedFor - (report.dispositions.unconsumed ?? 0);
    expect(consumed / report.sourceLines).toBeGreaterThan(0.95);
  });

  // Acceptance criterion 8.
  it("gives every session a client_request_key resolving to its R{row}C{col}", () => {
    for (const cell of report.cells) {
      for (const session of cell.result.sessions) {
        const m = /^import:(.+):(\d+):(\d+):(\d+)$/.exec(session.clientRequestKey);
        expect(m, `${cell.locator} key ${session.clientRequestKey}`).not.toBeNull();
        expect(`R${m![2]}C${m![3]}`).toBe(cell.locator);
      }
    }
  });

  it("makes every client_request_key unique across the whole import", () => {
    const keys = report.cells.flatMap((c) => c.result.sessions.map((s) => s.clientRequestKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Acceptance criterion 5 / brief: empty future weeks create nothing.
  it("creates no session from the empty future weeks", () => {
    expect(report.emptyFutureWeekRows.sessionsCreated).toBe(0);
    expect(report.cells.every((c) => c.weekNumber <= 31)).toBe(true);
  });

  it("dates every session inside the populated range", () => {
    for (const cell of report.cells) {
      for (const s of cell.result.sessions) {
        expect(s.localDate >= "2025-12-29").toBe(true);
        expect(s.localDate <= "2026-08-01").toBe(true);
      }
    }
  });

  // Acceptance criterion 11, at corpus scale.
  it("produces several sessions for dates that hold several sessions", () => {
    expect(report.multiSessionExamples.length).toBeGreaterThan(0);
    const r17c3 = report.multiSessionExamples.find((m) => m.locator === "R17C3");
    expect(r17c3?.localDate).toBe("2026-04-14");
    expect(r17c3?.titles).toHaveLength(2);
  });

  it("is deterministic — reconciling twice yields identical counts", () => {
    const again = reconcile(cells);
    expect(again.sessions).toBe(report.sessions);
    expect(again.activities).toBe(report.activities);
    expect(again.strengthSets).toBe(report.strengthSets);
    expect(again.unconsumedLines).toEqual(report.unconsumedLines);
  });
});

suite("report rendering", () => {
  const report = reconcile();

  // Acceptance criterion 16: the counts the brief's section 6.5 requires.
  it("includes every count the brief requires", () => {
    const md = renderReport(report);
    for (const needle of [
      "Source day cells discovered",
      "Staging entries created",
      "workout_sessions",
      "activities",
      "Unresolved exercise aliases",
      "Unresolved units and numbers",
      "Multi-session splits",
      "Empty future weeks",
      "Unconsumed source lines",
      "client_request_key",
    ]) {
      expect(md, `report is missing "${needle}"`).toContain(needle);
    }
    expect(md).toContain("| Source day cells discovered | 170 |");
  });

  it("names the workbook checksum the report refers to", () => {
    expect(renderReport(report)).toMatch(/Workbook SHA-256: `[0-9a-f]{64}`/);
  });

  it("builds a review queue of exactly the entries needing review", () => {
    const queue = renderReviewQueue(report);
    expect(queue).toHaveLength(report.entriesNeedingReview);
    for (const entry of queue) expect(entry.warnings.length).toBeGreaterThan(0);
  });
});
