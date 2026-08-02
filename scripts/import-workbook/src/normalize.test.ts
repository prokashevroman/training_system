import { describe, expect, it } from "vitest";
import { CELLS } from "./fixtures.js";
import { nonEmptyLines, normalizeCellText } from "./normalize.js";

const ruleIds = (text: string) => normalizeCellText(text).transforms.map((t) => t.rule);

describe("multiplication signs", () => {
  // R12C2 writes `4х155lb` with Cyrillic ha (U+0445), visually identical to x.
  it("converts the Cyrillic ha in R12C2 to a Latin x", () => {
    const raw = CELLS.R12C2!;
    expect(raw).toContain("4х155lb");
    const out = normalizeCellText(raw);
    expect(out.text).toContain("4x155lb");
    expect(out.text).not.toContain("х");
    expect(ruleIds(raw)).toContain("cyrillic-ha-to-x");
  });

  // R24C4: `105 push-ups as 35 × 3`
  it("converts the U+00D7 multiplication sign in R24C4", () => {
    const raw = CELLS.R24C4!;
    expect(raw).toContain("×");
    const out = normalizeCellText(raw);
    expect(out.text).toContain("35 x 3");
    expect(out.text).not.toContain("×");
  });

  // R30C2: `3 sets: 3*15 each hand weight 5`
  it("converts an asterisk between digits in R30C2", () => {
    const out = normalizeCellText(CELLS.R30C2!);
    expect(out.text).toContain("3x15");
    expect(ruleIds(CELLS.R30C2!)).toContain("asterisk-to-x");
  });

  it("leaves an asterisk that is not between digits alone", () => {
    expect(normalizeCellText("note * see below").text).toBe("note * see below");
  });
});

describe("decimal comma", () => {
  // R3C2: `1x97,5` must become 97.5, while `1x90, 3x95` stays a list.
  it("converts a decimal comma but not a list separator", () => {
    const out = normalizeCellText(CELLS.R3C2!);
    expect(out.text).toContain("1x97.5");
    expect(out.text).toContain("1x90, 3x95");
  });

  it("does not touch a comma followed by a space", () => {
    expect(normalizeCellText("6:17, fc promedio - 152lpm").text).toBe("6:17, fc promedio - 152lpm");
  });
});

describe("stray quotes", () => {
  // R8C4 opens `"Cindy 5 rounds:` and never closes the quote.
  it("strips the unbalanced double quote in R8C4", () => {
    expect(CELLS.R8C4!).toContain('"Cindy');
    const out = normalizeCellText(CELLS.R8C4!);
    expect(out.text).toContain("Cindy 5 rounds:");
    expect(out.text).not.toContain('"');
    expect(ruleIds(CELLS.R8C4!)).toContain("strip-unbalanced-double-quote");
  });

  it("keeps a balanced pair of quotes", () => {
    expect(normalizeCellText('said "hello" once').text).toBe('said "hello" once');
  });

  /**
   * The apostrophes in `didn't` (R24C4) and `wasn't` (R24C8) are the reason the
   * quote rule targets `"` only and keys on an odd count.
   */
  it("never touches apostrophes in contractions", () => {
    expect(normalizeCellText(CELLS.R24C4!).text).toContain("didn't");
    expect(normalizeCellText(CELLS.R24C8!).text).toContain("wasn't");
  });
});

describe("whitespace", () => {
  it("trims trailing spaces but preserves blank lines as block separators", () => {
    const out = normalizeCellText(CELLS.R12C2!);
    expect(out.text).toContain("Bench press:\n4x155lb");
    expect(out.text).toContain("4x165\n\n5 rounds:");
  });

  it("drops the leading blank line R30C2 starts with", () => {
    expect(CELLS.R30C2!.startsWith("\n")).toBe(true);
    expect(normalizeCellText(CELLS.R30C2!).text.startsWith("Single-arm")).toBe(true);
  });

  it("collapses runs of three or more newlines to one blank line", () => {
    expect(normalizeCellText("a\n\n\n\nb").text).toBe("a\n\nb");
  });
});

describe("traceability", () => {
  it("keeps the untouched original alongside the normalized text", () => {
    const out = normalizeCellText(CELLS.R12C2!);
    expect(out.original).toBe(CELLS.R12C2);
    expect(out.text).not.toBe(out.original);
  });

  it("records every rule it applied, with samples", () => {
    const out = normalizeCellText(CELLS.R12C2!);
    const cyrillic = out.transforms.find((t) => t.rule === "cyrillic-ha-to-x");
    expect(cyrillic).toBeDefined();
    expect(cyrillic!.count).toBe(1);
    expect(cyrillic!.examples[0]).toEqual({ before: "х", after: "x" });
  });

  it("reports no transforms for text that needs none", () => {
    expect(normalizeCellText("Swimming training").transforms).toEqual([]);
  });

  it("is idempotent — normalizing twice changes nothing further", () => {
    for (const raw of Object.values(CELLS)) {
      const once = normalizeCellText(raw).text;
      expect(normalizeCellText(once).text).toBe(once);
    }
  });
});

describe("nonEmptyLines", () => {
  it("counts only lines with content", () => {
    expect(nonEmptyLines("a\n\n b \n\n\nc")).toEqual(["a", "b", "c"]);
  });
});
