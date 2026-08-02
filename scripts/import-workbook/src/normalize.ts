/**
 * Cell-text normalization.
 *
 * Every rule here was chosen after auditing the actual bytes of all 170 cells,
 * not from a general idea of what messy text looks like. The audit found
 * exactly two non-ASCII characters in the whole corpus (Cyrillic `х` U+0445,
 * used four times as a multiplication sign, and `×` U+00D7, used once), seven
 * `digit,digit` sequences that are all genuine decimals, three `digit*digit`
 * sequences, and one unbalanced double quote. Rules are deliberately narrow so
 * they cannot damage text they were not written for — in particular the
 * apostrophes in `didn't` and `wasn't` must survive.
 *
 * Every applied rule is recorded, and the untouched original is carried
 * alongside, so the normalization is always reconstructible.
 */

export interface AppliedTransform {
  /** Stable rule id, reported in the reconciliation output. */
  rule: string;
  count: number;
  /** Up to three before/after samples, for the review queue. */
  examples: { before: string; after: string }[];
}

export interface NormalizedText {
  original: string;
  text: string;
  transforms: AppliedTransform[];
}

interface Rule {
  id: string;
  apply: (text: string) => { text: string; hits: { before: string; after: string }[] };
}

/** Replaces a global regex, recording each substitution it made. */
function replacing(id: string, re: RegExp, to: string): Rule {
  // A non-global clone lets each individual match be re-rendered on its own to
  // capture the `after` sample, without touching the outer regex's lastIndex.
  const single = new RegExp(re.source, re.flags.replace("g", ""));
  return {
    id,
    apply(text) {
      const hits: { before: string; after: string }[] = [];
      const out = text.replace(re, (match: string) => {
        const after = match.replace(single, to);
        hits.push({ before: match, after });
        return after;
      });
      return { text: out, hits };
    },
  };
}

const RULES: Rule[] = [
  {
    // Normalizes compatibility forms and composed characters. A no-op on this
    // corpus, but it protects future voice transcripts.
    id: "nfkc",
    apply(text) {
      const out = text.normalize("NFKC");
      return { text: out, hits: out === text ? [] : [{ before: text, after: out }] };
    },
  },
  {
    id: "crlf-to-lf",
    apply(text) {
      const out = text.replace(/\r\n?/g, "\n");
      return { text: out, hits: out === text ? [] : [{ before: "\\r\\n", after: "\\n" }] };
    },
  },
  // `4х155lb` (R12C2), `4х70` / `3х75` (R18C3), `4х75` (R20C3). Cyrillic ha is
  // visually identical to Latin x and is used as a multiplication sign.
  replacing("cyrillic-ha-to-x", /х/g, "x"),
  replacing("cyrillic-ha-upper-to-x", /Х/g, "X"),
  // `105 push-ups as 35 × 3` (R24C4).
  replacing("multiplication-sign-to-x", /×/g, "x"),
  // `3 sets: 3*15 each hand weight 5` (R30C2, R31C3, R32C3). Only between
  // digits, so a literal asterisk used as a footnote marker is left alone.
  replacing("asterisk-to-x", /(\d)\s*\*\s*(\d)/g, "$1x$2"),
  // `1x97,5` -> `1x97.5`. Only between digits: every `, ` in the corpus is a
  // list separator, and all seven digit-comma-digit hits are decimals.
  replacing("decimal-comma-to-dot", /(\d),(\d)/g, "$1.$2"),
  {
    // R8C4 opens a line with `"Cindy 5 rounds:` and never closes the quote.
    // Only an odd (therefore unbalanced) count is stripped, so a genuinely
    // quoted phrase would survive.
    id: "strip-unbalanced-double-quote",
    apply(text) {
      const count = (text.match(/"/g) ?? []).length;
      if (count === 0 || count % 2 === 0) return { text, hits: [] };
      return { text: text.replace(/"/g, ""), hits: [{ before: '"', after: "" }] };
    },
  },
  {
    // Collapses runs of spaces/tabs and trims each line, but preserves blank
    // lines: they are the splitter's primary signal and carry real meaning.
    id: "collapse-inline-whitespace",
    apply(text) {
      const hits: { before: string; after: string }[] = [];
      const out = text
        .split("\n")
        .map((line) => {
          const next = line.replace(/[^\S\n]+/g, " ").trim();
          if (next !== line && hits.length < 3) hits.push({ before: line, after: next });
          return next;
        })
        .join("\n");
      return { text: out, hits };
    },
  },
  {
    // Three or more newlines collapse to a paragraph break so block splitting
    // sees one consistent separator.
    id: "collapse-blank-runs",
    apply(text) {
      const out = text.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
      return { text: out, hits: out === text ? [] : [{ before: "\\n{3,}", after: "\\n\\n" }] };
    },
  },
];

export function normalizeCellText(input: string): NormalizedText {
  let text = input;
  const transforms: AppliedTransform[] = [];

  for (const rule of RULES) {
    const { text: next, hits } = rule.apply(text);
    if (hits.length > 0) {
      transforms.push({ rule: rule.id, count: hits.length, examples: hits.slice(0, 3) });
    }
    text = next;
  }

  return { original: input, text, transforms };
}

/** Non-empty lines of normalized text, used for reconciliation accounting. */
export function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
