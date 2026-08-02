// @vitest-environment node
// Schema and payload mapping only; the form rendering needs no assertions here.
import type { WorkoutSession } from "@training/db-types";
import { describe, expect, it } from "vitest";
import {
  SessionEditSchema,
  durationTextToSeconds,
  editFormToPatch,
  sessionToEditForm,
  type SessionEditForm,
} from "./SessionEditForm.js";

const MURPH: WorkoutSession = {
  client_request_key: "import:Training programm 2026:24:8:1",
  created_at: "2026-06-07T00:00:00Z",
  duration_seconds: 3532,
  id: "session-murph",
  local_date: "2026-06-07",
  notes: null,
  planned_session_id: null,
  raw_text: "Full Murph (vest, total time - 58:52)",
  session_rpe: null,
  source: "excel_import",
  started_at: null,
  status: "completed",
  title: "Full Murph (vest, total time - 58:52)",
  transcript: null,
  updated_at: "2026-06-07T00:00:00Z",
  user_id: "user-1",
};

function form(overrides: Partial<SessionEditForm> = {}): SessionEditForm {
  return { ...sessionToEditForm(MURPH), ...overrides };
}

describe("durationTextToSeconds", () => {
  it("reads a clock", () => {
    expect(durationTextToSeconds("58:52")).toBe(3532);
    expect(durationTextToSeconds("1:01:00")).toBe(3660);
  });

  it("reads a bare number as whole minutes", () => {
    expect(durationTextToSeconds("45")).toBe(2700);
  });

  it("treats an empty field as not recorded", () => {
    expect(durationTextToSeconds("")).toBeNull();
    expect(durationTextToSeconds("   ")).toBeNull();
  });

  it("refuses nonsense instead of guessing", () => {
    expect(durationTextToSeconds("about an hour")).toBeNull();
    expect(durationTextToSeconds("-5")).toBeNull();
  });
});

describe("sessionToEditForm", () => {
  it("round-trips the Murph duration through the clock format", () => {
    const edited = sessionToEditForm(MURPH);
    expect(edited.duration).toBe("58:52");
    expect(durationTextToSeconds(edited.duration)).toBe(3532);
  });

  it("shows unrecorded numbers as empty strings, not zeros", () => {
    expect(sessionToEditForm(MURPH)).toMatchObject({ sessionRpe: "", notes: "" });
  });
});

describe("editFormToPatch", () => {
  it("keeps only the session-level columns", () => {
    expect(Object.keys(editFormToPatch(form())).sort()).toEqual([
      "duration_seconds",
      "local_date",
      "notes",
      "session_rpe",
      "status",
      "title",
    ]);
  });

  it("writes null for a cleared field rather than 0 or an empty string", () => {
    expect(editFormToPatch(form({ sessionRpe: "", duration: "", notes: "  " }))).toMatchObject({
      session_rpe: null,
      duration_seconds: null,
      notes: null,
    });
  });

  it("carries the edited values through", () => {
    expect(
      editFormToPatch(
        form({
          title: "  Full Murph  ",
          localDate: "2026-06-08",
          status: "draft",
          sessionRpe: "9.5",
          duration: "59:00",
          notes: "Vest 9 kg",
        }),
      ),
    ).toEqual({
      title: "Full Murph",
      local_date: "2026-06-08",
      status: "draft",
      notes: "Vest 9 kg",
      session_rpe: 9.5,
      duration_seconds: 3540,
    });
  });
});

describe("SessionEditSchema", () => {
  it("requires a title", () => {
    expect(SessionEditSchema.safeParse(form({ title: "   " })).success).toBe(false);
  });

  it("requires an ISO local date", () => {
    expect(SessionEditSchema.safeParse(form({ localDate: "07/06/2026" })).success).toBe(false);
  });

  it("keeps session RPE inside 0–10, matching the database check", () => {
    expect(SessionEditSchema.safeParse(form({ sessionRpe: "11" })).success).toBe(false);
    expect(SessionEditSchema.safeParse(form({ sessionRpe: "10" })).success).toBe(true);
    expect(SessionEditSchema.safeParse(form({ sessionRpe: "" })).success).toBe(true);
  });

  it("rejects an unparseable duration", () => {
    expect(SessionEditSchema.safeParse(form({ duration: "an hour" })).success).toBe(false);
    expect(SessionEditSchema.safeParse(form({ duration: "58:52" })).success).toBe(true);
  });

  it("rejects a status outside the enum", () => {
    expect(SessionEditSchema.safeParse({ ...form(), status: "finished" as never }).success).toBe(
      false,
    );
  });
});
