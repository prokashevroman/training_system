import { describe, expect, it } from "vitest";
import {
  buildInsertBundle,
  deriveLoadKg,
  emptyManualActivity,
  emptyManualSession,
  emptyManualSet,
  loadStorageHint,
  newManualRequestKey,
  toSessionDraft,
  type ManualSessionForm,
} from "./record-queries.js";

/** Sequential ids keep the assertions readable and the bundle deterministic. */
function idFactory() {
  let n = 0;
  return () => `id-${++n}`;
}

const SLUGS = new Map([["back-squat", "exercise-back-squat"]]);

function formWithSet(overrides: Partial<ReturnType<typeof emptyManualSet>>): ManualSessionForm {
  const form = emptyManualSession();
  return {
    ...form,
    title: "Lower body",
    activities: [
      {
        ...emptyManualActivity("strength"),
        sets: [{ ...emptyManualSet(), exerciseRawText: "Back squat", ...overrides }],
      },
    ],
  };
}

describe("deriveLoadKg", () => {
  it("normalizes a stated kilogram load", () => {
    expect(deriveLoadKg(72.5, "kg", "total")).toBe(72.5);
  });

  it("converts pounds using the definitional factor", () => {
    expect(deriveLoadKg(100, "lb", "total")).toBe(45.36);
  });

  it("keeps a per-hand load per hand rather than doubling it", () => {
    expect(deriveLoadKg(20, "kg", "per_hand")).toBe(20);
  });

  it("withholds kilograms when the source stated no unit", () => {
    expect(deriveLoadKg(165, "none", "total")).toBeNull();
  });

  it("withholds kilograms for a machine setting even when a unit is selected", () => {
    expect(deriveLoadKg(6, "kg", "machine_setting")).toBeNull();
  });

  it("withholds kilograms for bodyweight and unknown scopes", () => {
    expect(deriveLoadKg(80, "kg", "bodyweight")).toBeNull();
    expect(deriveLoadKg(80, "kg", "unknown")).toBeNull();
  });

  it("records nothing when no load was entered", () => {
    expect(deriveLoadKg(null, "kg", "total")).toBeNull();
  });
});

describe("loadStorageHint", () => {
  it("says a machine setting stores no kilogram value", () => {
    expect(loadStorageHint("6", "kg", "machine_setting")).toContain("No kilogram value");
  });

  it("says a unitless load stores no kilogram value", () => {
    expect(loadStorageHint("165", "none", "total")).toContain("No kilogram value");
  });

  it("shows the derived kilogram figure for a convertible load", () => {
    expect(loadStorageHint("100", "lb", "total")).toContain("45.36 kg");
  });
});

describe("toSessionDraft", () => {
  it("turns blank numeric fields into nulls instead of zeros", () => {
    const draft = toSessionDraft(formWithSet({}), "manual:key");
    expect(draft.durationSeconds).toBeNull();
    expect(draft.sessionRpe).toBeNull();
    const activity = draft.activities[0]!;
    expect(activity.distanceKm).toBeNull();
    expect(activity.avgHeartRateBpm).toBeNull();
    expect(activity.strengthSets[0]!.reps).toBeNull();
    expect(activity.strengthSets[0]!.loadValue).toBeNull();
  });

  it("converts entered minutes to seconds", () => {
    const form: ManualSessionForm = {
      ...emptyManualSession(),
      title: "Run",
      durationMinutes: "62.5",
      activities: [{ ...emptyManualActivity("running"), durationMinutes: "30" }],
    };
    const draft = toSessionDraft(form, "manual:key");
    expect(draft.durationSeconds).toBe(3750);
    expect(draft.activities[0]!.durationSeconds).toBe(1800);
  });

  it("accepts a decimal comma, as the corpus writes it", () => {
    const draft = toSessionDraft(formWithSet({ loadValue: "97,5" }), "manual:key");
    expect(draft.activities[0]!.strengthSets[0]!.loadValue).toBe(97.5);
  });

  it("numbers sets from one in entry order", () => {
    const form = emptyManualSession();
    const draft = toSessionDraft(
      {
        ...form,
        title: "Push",
        activities: [
          {
            ...emptyManualActivity("strength"),
            sets: [
              { ...emptyManualSet(), exerciseRawText: "Bench press" },
              { ...emptyManualSet(), exerciseRawText: "Dips" },
            ],
          },
        ],
      },
      "manual:key",
    );
    expect(draft.activities[0]!.strengthSets.map((s) => s.setIndex)).toEqual([1, 2]);
  });

  it("drops sets left over from a modality change so they are not misfiled", () => {
    const form: ManualSessionForm = {
      ...emptyManualSession(),
      title: "Row",
      activities: [
        {
          ...emptyManualActivity("rowing"),
          sets: [{ ...emptyManualSet(), exerciseRawText: "Row" }],
        },
      ],
    };
    expect(toSessionDraft(form, "manual:key").activities[0]!.strengthSets).toEqual([]);
  });

  it("passes the domain schema for a machine setting, because no kilograms are derived", () => {
    const draft = toSessionDraft(
      formWithSet({
        exerciseRawText: "Lat pulldown",
        loadValue: "6",
        loadScope: "machine_setting",
      }),
      "manual:key",
    );
    const set = draft.activities[0]!.strengthSets[0]!;
    expect(set.loadValue).toBe(6);
    expect(set.loadKg).toBeNull();
  });

  it("claims confidence only when the exercise resolved to the library", () => {
    const resolved = toSessionDraft(
      formWithSet({ exerciseRawText: "Back squat", exerciseSlug: "back-squat" }),
      "manual:key",
    );
    expect(resolved.activities[0]!.strengthSets[0]!.exercise).toMatchObject({
      slug: "back-squat",
      confidence: 1,
    });

    const freeText = toSessionDraft(
      formWithSet({ exerciseRawText: "Sandbag carry" }),
      "manual:key",
    );
    expect(freeText.activities[0]!.strengthSets[0]!.exercise).toMatchObject({
      slug: null,
      confidence: 0,
    });
  });

  it("refuses a session with no title", () => {
    expect(() => toSessionDraft(emptyManualSession(), "manual:key")).toThrow();
  });

  it("refuses a set with no exercise named, rather than storing a blank one", () => {
    expect(() => toSessionDraft(formWithSet({ exerciseRawText: "" }), "manual:key")).toThrow();
  });
});

describe("buildInsertBundle", () => {
  const draft = toSessionDraft(
    {
      ...emptyManualSession(),
      title: "Lower body",
      activities: [
        {
          ...emptyManualActivity("strength"),
          sets: [
            {
              ...emptyManualSet(),
              exerciseRawText: "Back squat",
              exerciseSlug: "back-squat",
              reps: "5",
              loadValue: "80",
            },
            {
              ...emptyManualSet(),
              exerciseRawText: "Lat pulldown",
              loadValue: "6",
              loadScope: "machine_setting",
            },
          ],
        },
        { ...emptyManualActivity("running"), distanceKm: "4" },
      ],
    },
    "manual:abc",
  );
  const bundle = buildInsertBundle(draft, "user-1", SLUGS, idFactory());

  it("stamps user_id on every row, as the composite foreign keys require", () => {
    const rows = [bundle.session, ...bundle.activities, ...bundle.strengthSets];
    expect(rows.every((row) => row.user_id === "user-1")).toBe(true);
  });

  it("links children to the parents generated in the same pass", () => {
    expect(bundle.activities.every((a) => a.session_id === bundle.session.id)).toBe(true);
    expect(bundle.strengthSets.every((s) => s.activity_id === bundle.activities[0]!.id)).toBe(true);
  });

  it("marks the session manual and carries the idempotency key", () => {
    expect(bundle.session.source).toBe("manual");
    expect(bundle.session.client_request_key).toBe("manual:abc");
  });

  it("resolves a library slug to its exercise id and leaves free text unresolved", () => {
    expect(bundle.strengthSets[0]!.exercise_id).toBe("exercise-back-squat");
    expect(bundle.strengthSets[0]!.exercise_raw_text).toBe("Back squat");
    expect(bundle.strengthSets[1]!.exercise_id).toBeNull();
    expect(bundle.strengthSets[1]!.exercise_raw_text).toBe("Lat pulldown");
  });

  it("sends no load_kg for the rows the database CHECK constraints would reject", () => {
    expect(bundle.strengthSets[0]!.load_kg).toBe(80);
    expect(bundle.strengthSets[1]!.load_scope).toBe("machine_setting");
    expect(bundle.strengthSets[1]!.load_kg).toBeNull();
    expect(bundle.strengthSets[1]!.load_value).toBe(6);
  });

  it("keeps activity order as sequence 1..n", () => {
    expect(bundle.activities.map((a) => a.sequence)).toEqual([1, 2]);
    expect(bundle.activities[1]!.distance_km).toBe(4);
  });
});

describe("newManualRequestKey", () => {
  it("is namespaced and unique per draft", () => {
    const key = newManualRequestKey();
    expect(key).toMatch(/^manual:[0-9a-f-]{36}$/);
    expect(newManualRequestKey()).not.toBe(key);
  });
});
