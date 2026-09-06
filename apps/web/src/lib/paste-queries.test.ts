import { describe, expect, it } from "vitest";
import {
  applyPasteEdits,
  extractLeadingDate,
  groupSetsForPreview,
  newEntryBatchKey,
  newPasteRequestKey,
  parsePastedText,
} from "./paste-queries.js";
import {
  assertExerciseLinksResolvable,
  buildInsertBundle,
  unsupportedDraftParts,
} from "./record-queries.js";

/**
 * Paste entry, tested against the notation actually used in the spreadsheet.
 *
 * `SESSION` is a real day's lifting written the way it is written by hand,
 * including the parts that make the load semantics matter: "each arm", "in each
 * hand", and a weighted pull-up whose 5 kg is added to bodyweight rather than
 * being the load. Collapsing those three into one kilogram column is the
 * failure this suite exists to catch.
 */

const SESSION = `Single-arm cable rear-delt fly 3 sets x12 reps each arm (7.5kg) too light
Weighted strict pull-up: 4x5 (5kg)
Seated cable row, 3x10 (45kg)
Seated dumbbell overhead press, 3 sets x 10reps (16kg in each hand) 75 degrees
Incline DB press, 30 degrees 3x10 (16kg in each hand)`;

const DATE = "2026-08-31";
const KEY = "paste:11111111-2222-4333-8444-555555555555";

function parse(text = SESSION) {
  return parsePastedText(text, DATE, KEY);
}

describe("parsePastedText", () => {
  it("returns nothing for empty text rather than an empty session", () => {
    const result = parsePastedText("   \n  ", DATE, KEY);
    expect(result.sessions).toEqual([]);
    expect(result.setCount).toBe(0);
  });

  it("maps five written lines onto one session of sixteen sets", () => {
    const result = parse();
    expect(result.sessions).toHaveLength(1);
    expect(result.setCount).toBe(16);
    expect(result.unconsumedLines).toEqual([]);
  });

  it("expands `3x10` into three separate set rows", () => {
    const sets = parse().sessions[0]!.draft.activities[0]!.strengthSets;
    const rows = sets.filter((s) => s.exercise.slug === "seated-cable-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((s) => s.reps)).toEqual([10, 10, 10]);
    expect(rows.map((s) => s.loadKg)).toEqual([45, 45, 45]);
  });

  it("keeps the three load scopes distinct instead of collapsing them", () => {
    const sets = parse().sessions[0]!.draft.activities[0]!.strengthSets;
    const scopeOf = (slug: string) => sets.find((s) => s.exercise.slug === slug)?.loadScope;

    // "each arm" — 7.5 kg is per side, not 15 kg of system load.
    expect(scopeOf("cable-rear-delt-fly")).toBe("per_side");
    // "in each hand" — two 16 kg dumbbells, not one 16 kg press.
    expect(scopeOf("overhead-press")).toBe("per_hand");
    // A weighted pull-up's 5 kg is added to bodyweight.
    expect(scopeOf("pull-ups-weighted")).toBe("added_bodyweight");
    // A plain cable row states the whole load.
    expect(scopeOf("seated-cable-row")).toBe("total");
  });

  it("warns about every per-side load rather than silently doubling it", () => {
    const codes = parse().warnings.map((w) => w.code);
    expect(codes.filter((c) => c === "PER_SIDE_LOAD")).toHaveLength(3);
  });

  it("reports an exercise no alias resolves, and still keeps its text", () => {
    const result = parse();
    expect(result.unresolvedExercises).toEqual(["Incline DB press, 30 degrees"]);

    const unlinked = result.sessions[0]!.draft.activities[0]!.strengthSets.filter(
      (s) => s.exercise.slug === null,
    );
    expect(unlinked).toHaveLength(3);
    expect(unlinked[0]!.exercise.rawText).toBe("Incline DB press, 30 degrees");
    // The reps and the load survive even though the exercise did not resolve.
    expect(unlinked[0]!.reps).toBe(10);
    expect(unlinked[0]!.loadKg).toBe(16);
  });

  it("records the paste as manually entered, not as an import", () => {
    const draft = parse().sessions[0]!.draft;
    expect(draft.source).toBe("manual");
    expect(draft.transcript).toBeNull();
    expect(draft.clientRequestKey).toBe(`${KEY}:1`);
    expect(draft.localDate).toBe(DATE);
  });

  it("keeps voice provenance and the transcript when an origin is supplied", () => {
    // The structured-voice flow parses a rewrite while `raw_text` must keep the
    // transcript that actually entered the system.
    const transcript = "did the cable rows, three by ten at forty five";
    const result = parsePastedText("Seated cable row, 3x10 (45kg)", DATE, "voice:key", {
      source: "voice",
      rawText: transcript,
      transcript,
    });
    const draft = result.sessions[0]!.draft;
    expect(draft.source).toBe("voice");
    expect(draft.rawText).toBe(transcript);
    expect(draft.transcript).toBe(transcript);
    expect(draft.activities[0]!.strengthSets).toHaveLength(3);
  });

  it("keeps the pasted text verbatim so an unread line is never lost", () => {
    const draft = parse().sessions[0]!.draft;
    expect(draft.rawText).toContain("too light");
    expect(draft.rawText).toContain("75 degrees");
  });

  it("stores the pasted bytes exactly, not the parser's normalized copy", () => {
    // Every one of these is rewritten by `normalizeCellText` before parsing:
    // CRLF, a run of spaces, a decimal comma, and the U+00D7 multiplication
    // sign. `raw_text` is the column that promises re-derivability, so it has
    // to hold what was actually typed.
    const original = "Seated cable row,  3x10   (97,5kg)\r\nIncline press 3 × 10 (16kg)";
    const draft = parsePastedText(original, DATE, KEY).sessions[0]!.draft;

    expect(draft.rawText).toBe(original);
    expect(draft.rawText).toContain("97,5");
    expect(draft.rawText).toContain("\r\n");
    expect(draft.rawText).toContain("×");

    // The parse itself still runs on normalized text, so the decimal is read.
    const loads = draft.activities[0]!.strengthSets.map((s) => s.loadValue);
    expect(loads).toContain(97.5);
  });

  it("gives every session from one paste the full original text", () => {
    const original = "Back squat 3x5 (100kg)\n\nBike to & from work";
    const result = parsePastedText(original, DATE, KEY);
    expect(result.sessions.length).toBeGreaterThan(1);
    for (const { draft } of result.sessions) {
      expect(draft.rawText).toBe(original);
    }
  });

  it("shortens a title taken from a whole first line", () => {
    const title = parse().sessions[0]!.title;
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("separates a commute from lifting, and keys each session distinctly", () => {
    const result = parse(`Back squat 5x5: 1x80, 3x85, 1x90\n\nBike to & from work`);
    expect(result.sessions.length).toBeGreaterThan(1);
    const keys = result.sessions.map((s) => s.draft.clientRequestKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(`${KEY}:1`);
  });

  it("keeps two lifting blocks as ONE session even with a blank line between", () => {
    // `mergeAdjacentSameKind` in the splitter is deliberate: two strength
    // blocks are one gym session, and staying merged is the reversible choice.
    // The screen's wording has to match this, not the other way round.
    const result = parse("Back squat 3x5 (100kg)\n\nBench press 3x5 (80kg)");
    expect(result.sessions).toHaveLength(1);
    expect(result.setCount).toBe(6);

    const rawTexts = result.sessions[0]!.draft.activities.flatMap((a) =>
      a.strengthSets.map((s) => s.exercise.rawText),
    );
    expect(new Set(rawTexts)).toEqual(new Set(["Back squat", "Bench press"]));
  });

  it("lists a line it cannot read instead of dropping it", () => {
    const result = parse("Warm-up: 10 minutes, jumping jacks, joint mobility.");
    expect(result.unconsumedLines).toHaveLength(1);
  });
});

describe("every parsed shape reaches a table", () => {
  const USER = "11111111-2222-4333-8444-555555555555";

  function bundleOf(text: string) {
    const result = parse(text);
    expect(result.unsupported).toEqual([]);
    return buildInsertBundle(applyPasteEdits(result.sessions[0]!, new Map()), USER, {
      exerciseIdBySlug: new Map(),
      benchmarkIdBySlug: new Map([["cindy", "bm-cindy-id"]]),
    });
  }

  it("saves interval training as interval rows — the Norwegian VO2 max case", () => {
    // The exact entry that was once refused: pace-list intervals plus a note.
    const bundle = bundleOf(
      "Norwegian VO2 max running training:\nFast intervals pace: 4:09 - 3:58 - 3:55 - 4:04\nRunning straight, not in circles, purple shoes",
    );
    expect(bundle.cardioIntervals).toHaveLength(4);
    expect(bundle.cardioIntervals.map((row) => row.pace_seconds_per_km)).toEqual([
      249, 238, 235, 244,
    ]);
    expect(bundle.cardioIntervals.map((row) => row.interval_index)).toEqual([1, 2, 3, 4]);
    const activityId = bundle.activities[0]!.id;
    for (const row of bundle.cardioIntervals) {
      expect(row.activity_id).toBe(activityId);
      expect(row.user_id).toBe(USER);
    }
  });

  it("saves a benchmark with its splits and the definition link", () => {
    const bundle = bundleOf(
      "Murph preperation (vest 9 kg):\nrun 1600 m\nCindy 5 rounds\nrun 1600 m",
    );
    expect(bundle.benchmarkResults).toHaveLength(1);
    expect(bundle.benchmarkSplits).toHaveLength(2);
    expect(bundle.benchmarkSplits[0]!.benchmark_result_id).toBe(bundle.benchmarkResults[0]!.id);
  });

  it("saves a circuit with its movements", () => {
    const bundle = bundleOf("5 rounds: 10 push ups / 15 air squats / 20 sit ups");
    expect(bundle.circuitResults).toHaveLength(1);
    expect(bundle.circuitMovements).toHaveLength(3);
    expect(bundle.circuitResults[0]!.rounds_prescribed).toBe(5);
    expect(bundle.circuitMovements[0]!.circuit_result_id).toBe(bundle.circuitResults[0]!.id);
  });

  it("lets a commute through: subtype is a column, not a child table", () => {
    const bundle = bundleOf("Bike to & from work");
    expect(bundle.activities[0]!.subtype).toBe("commute");
  });

  it("carries a steady run's average pace into the activity row", () => {
    // `5:50 per km` on a plain run was dropped until migration 0013 gave it a
    // column; this pins the whole path: parse -> draft -> insert payload.
    const bundle = bundleOf("5.7 km outdoor run\n5:50 per km\ncadencia - 168");
    const activity = bundle.activities[0]!;
    expect(activity.distance_km).toBe(5.7);
    expect(activity.avg_pace_seconds_per_km).toBe(350);
    expect(activity.cadence_spm).toBe(168);
  });
});

describe("unsupportedDraftParts", () => {
  it("reports only tags, the one draft field still without a table", () => {
    const base = parse().sessions[0]!.draft;
    expect(unsupportedDraftParts(base)).toEqual([]);
    expect(unsupportedDraftParts({ ...base, tags: ["legs"] })).toEqual(["1 tag"]);
  });
});

describe("assertExerciseLinksResolvable", () => {
  const READY = { idBySlug: new Map<string, string>(), isReady: true };
  const LOADING = { idBySlug: new Map<string, string>(), isReady: false };

  it("refuses a draft with resolved slugs while the library is unavailable", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    expect(() => assertExerciseLinksResolvable(draft, LOADING)).toThrow(/exercise library/i);
  });

  it("allows the same draft once the library has loaded", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    expect(() => assertExerciseLinksResolvable(draft, READY)).not.toThrow();
  });

  it("allows free text with no slug, which has no link to lose", () => {
    const draft = applyPasteEdits(
      parse("Incline DB press, 30 degrees 3x10 (16kg)").sessions[0]!,
      new Map(),
    );
    const slugs = draft.activities.flatMap((a) => a.strengthSets.map((s) => s.exercise.slug));
    expect(slugs.every((s) => s === null)).toBe(true);
    expect(() => assertExerciseLinksResolvable(draft, LOADING)).not.toThrow();
  });
});

describe("date-prefixed entries", () => {
  it("moves a leading `31.08:` into the date and parses the rest", () => {
    // The exact shape of the real 31.08 voice entry: date line, blank line,
    // then workbook notation. The date line is not training and must not
    // produce a junk activity.
    const entered = `31.08: \n\n${SESSION}`;
    const dated = extractLeadingDate(entered, "2026-09-06");
    expect(dated.localDate).toBe("2026-08-31");

    const result = parsePastedText(dated.rest, dated.localDate!, KEY, {
      source: "voice",
      rawText: entered,
      transcript: entered,
    });
    expect(result.sessions).toHaveLength(1);
    expect(result.unconsumedLines).toEqual([]);
    const draft = result.sessions[0]!.draft;
    expect(draft.localDate).toBe("2026-08-31");
    expect(draft.activities).toHaveLength(1);
    expect(draft.activities[0]!.strengthSets).toHaveLength(16);
    // The date line survives in raw_text even though the parser never saw it.
    expect(draft.rawText.startsWith("31.08:")).toBe(true);
  });
});

describe("newPasteRequestKey", () => {
  it("is prefixed so provenance stays readable in the database", () => {
    expect(newPasteRequestKey()).toMatch(/^paste:[0-9a-f-]{36}$/);
  });

  it("prefixes voice-originated batches as voice, per the key contract", () => {
    expect(newEntryBatchKey("voice")).toMatch(/^voice:[0-9a-f-]{36}$/);
    expect(newEntryBatchKey("manual")).toMatch(/^paste:[0-9a-f-]{36}$/);
  });
});

describe("groupSetsForPreview", () => {
  it("collapses identical consecutive sets without merging different ones", () => {
    const groups = groupSetsForPreview(parse().sessions[0]!.draft.activities[0]!.strengthSets);
    expect(groups.map((g) => [g.exerciseRawText, g.setCount, g.reps])).toEqual([
      ["Single-arm cable rear-delt fly", 3, 12],
      ["Weighted strict pull-up", 4, 5],
      ["Seated cable row", 3, 10],
      ["Seated dumbbell overhead press", 3, 10],
      ["Incline DB press, 30 degrees", 3, 10],
    ]);
  });

  it("keeps a run separate when the load changes mid-exercise", () => {
    const sets = parse("Back squat 5x5: 1x80, 3x85, 1x90").sessions[0]!.draft.activities[0]!
      .strengthSets;
    const groups = groupSetsForPreview(sets);
    expect(groups.map((g) => [g.setCount, g.loadValue])).toEqual([
      [1, 80],
      [3, 85],
      [1, 90],
    ]);
  });
});

describe("applyPasteEdits", () => {
  it("links an exercise the athlete picked without touching the pasted text", () => {
    const session = parse().sessions[0]!;
    const edited = applyPasteEdits(
      session,
      new Map([["Incline DB press, 30 degrees", "incline-dumbbell-press"]]),
    );

    const linked = edited.activities[0]!.strengthSets.filter(
      (s) => s.exercise.rawText === "Incline DB press, 30 degrees",
    );
    expect(linked).toHaveLength(3);
    for (const set of linked) {
      expect(set.exercise.slug).toBe("incline-dumbbell-press");
      // A human picked it, so it is not a matcher's guess.
      expect(set.exercise.confidence).toBe(1);
      expect(set.exercise.rawText).toBe("Incline DB press, 30 degrees");
    }
  });

  it("leaves an already-resolved exercise alone", () => {
    const session = parse().sessions[0]!;
    const edited = applyPasteEdits(session, new Map([["Seated cable row", "back-squat"]]));
    const row = edited.activities[0]!.strengthSets.find(
      (s) => s.exercise.rawText === "Seated cable row",
    );
    expect(row!.exercise.slug).toBe("seated-cable-row");
  });

  it("uses the edited title, falling back to the parser's when blanked", () => {
    const session = parse().sessions[0]!;
    expect(applyPasteEdits({ ...session, title: "Push day" }, new Map()).title).toBe("Push day");
    expect(applyPasteEdits({ ...session, title: "   " }, new Map()).title).toBe(
      session.draft.title,
    );
  });
});

describe("buildInsertBundle over a pasted session", () => {
  const USER = "11111111-2222-4333-8444-555555555555";

  it("produces one session, one activity and sixteen set rows", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    const bundle = buildInsertBundle(draft, USER, {
      exerciseIdBySlug: new Map([["seated-cable-row", "ex-row-id"]]),
    });

    expect(bundle.activities).toHaveLength(1);
    expect(bundle.strengthSets).toHaveLength(16);
    expect(bundle.session.source).toBe("manual");
    expect(bundle.session.user_id).toBe(USER);
  });

  it("links a known slug and leaves an unknown one null with its text kept", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    const bundle = buildInsertBundle(draft, USER, {
      exerciseIdBySlug: new Map([["seated-cable-row", "ex-row-id"]]),
    });

    const row = bundle.strengthSets.find((s) => s.exercise_raw_text === "Seated cable row");
    expect(row!.exercise_id).toBe("ex-row-id");

    // Resolved by the parser, but absent from the library map passed in.
    const press = bundle.strengthSets.find(
      (s) => s.exercise_raw_text === "Seated dumbbell overhead press",
    );
    expect(press!.exercise_id).toBeNull();
    expect(press!.load_scope).toBe("per_hand");
  });

  it("stamps the same user_id on every child row", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    const bundle = buildInsertBundle(draft, USER, { exerciseIdBySlug: new Map() });
    for (const row of [...bundle.activities, ...bundle.strengthSets]) {
      expect(row.user_id).toBe(USER);
    }
  });

  it("numbers sets from one, in source order, across exercises", () => {
    const draft = applyPasteEdits(parse().sessions[0]!, new Map());
    const bundle = buildInsertBundle(draft, USER, { exerciseIdBySlug: new Map() });
    expect(bundle.strengthSets.map((s) => s.set_index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });
});
