import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractLeadingDate, SessionDraftSchema, type SessionDraft } from "@training/domain";
import { parseCell } from "../parse.js";

/**
 * Restructure one unstructured session in place.
 *
 * A session saved as a plain note (voice transcript, quick manual text) has
 * `raw_text` and no children. This tool runs the *same* deterministic parser
 * the importer and paste entry run over that text, and attaches the resulting
 * activities and sets to the existing row — same id, same
 * `client_request_key`, same verbatim `raw_text`, so provenance and
 * re-derivability are untouched. A leading date line (`31.08:`) becomes the
 * session's `local_date` instead of a junk activity.
 *
 * Deliberately narrow, following the app's own insert path
 * (`buildInsertBundle` in apps/web/src/lib/record-queries.ts): it writes
 * activities, strength sets and cardio intervals, refuses drafts that need the
 * circuit or benchmark tables, refuses a text that parses into several
 * sessions, and refuses a session that already has children. Anything it
 * cannot do losslessly, it reports instead of doing.
 *
 * Dry-run by default, like the importer:
 *
 *   npx tsx src/tools/restructure-session.ts --key "voice:<uuid>"
 *   npx tsx src/tools/restructure-session.ts --key "voice:<uuid>" --apply
 */

const PKG = fileURLToPath(new URL("../..", import.meta.url));

function loadEnv(): { url: string; key: string } {
  const envPath = `${PKG}.env.import`;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] && !process.env[m[1]])
        process.env[m[1]] = m[2]!.trim().replace(/^["']|["']$/g, "");
    }
  }
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env.import).");
  }
  return { url, key };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} needs a value.`);
  }
  return value;
}

/** Same 60-char title rule as paste entry (`shortTitle` in paste-queries.ts). */
function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * What this tool cannot write. Narrower than the app since the app learned all
 * child tables (2026-09): sets and cardio intervals cover every plain note seen
 * so far, so circuits and benchmarks are refused here rather than duplicating
 * that mapping — re-enter those through the app's Record screen instead.
 */
function unsupportedParts(draft: SessionDraft): string[] {
  const parts: string[] = [];
  let circuits = 0;
  let benchmarks = 0;
  for (const activity of draft.activities) {
    if (activity.circuit !== null) circuits += 1;
    if (activity.benchmark !== null) benchmarks += 1;
  }
  if (circuits > 0) parts.push(`${circuits} circuits`);
  if (benchmarks > 0) parts.push(`${benchmarks} benchmark results`);
  if (draft.tags.length > 0) parts.push(`${draft.tags.length} tags`);
  return parts;
}

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const key = arg("key");
  const apply = process.argv.includes("--apply");
  if (!key) throw new Error('Usage: restructure-session.ts --key "voice:<uuid>" [--apply]');

  const env = loadEnv();
  const db: SupabaseClient = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const found = await db
    .from("workout_sessions")
    .select("id, user_id, local_date, title, source, raw_text, activities(id)")
    .eq("client_request_key", key)
    .maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) throw new Error(`No session with client_request_key ${key}.`);
  const session = found.data;

  if ((session.activities ?? []).length > 0) {
    throw new Error(
      `Session ${session.id} already has ${session.activities.length} activities — nothing to restructure.`,
    );
  }

  // The date the athlete wrote wins over the date the row was saved on.
  const dated = extractLeadingDate(session.raw_text ?? "", todayLocalDate());
  const localDate = dated.localDate ?? session.local_date;

  const parsed = parseCell({
    sheet: "restructure",
    row: 1,
    col: 1,
    localDate,
    rawText: dated.rest,
  });

  if (parsed.sessions.length !== 1) {
    throw new Error(
      `The text parses into ${parsed.sessions.length} sessions; in-place restructuring keeps one row one session. Re-enter it through the app's paste screen instead.`,
    );
  }
  const draft = SessionDraftSchema.parse(parsed.sessions[0]);
  const unsupported = unsupportedParts(draft);
  if (unsupported.length > 0) {
    throw new Error(`The parse needs tables this tool does not write: ${unsupported.join(", ")}.`);
  }

  const exercises = await db.from("exercises").select("id, slug");
  if (exercises.error) throw exercises.error;
  const idBySlug = new Map((exercises.data ?? []).map((row) => [row.slug, row.id]));

  const setCount = draft.activities.reduce((n, a) => n + a.strengthSets.length, 0);
  const intervalCount = draft.activities.reduce((n, a) => n + a.cardioIntervals.length, 0);
  console.log(`Session ${session.id} (${session.source}, was ${session.local_date})`);
  console.log(`  -> local_date ${localDate}${dated.localDate ? " (from the text)" : ""}`);
  console.log(`  -> title ${JSON.stringify(shortTitle(draft.title))}`);
  console.log(
    `  -> ${draft.activities.length} activities, ${setCount} sets, ${intervalCount} intervals`,
  );
  for (const warning of parsed.warnings) console.log(`  warn ${warning.code}: ${warning.message}`);
  for (const line of parsed.unconsumedLines) console.log(`  unconsumed: ${JSON.stringify(line)}`);

  if (!apply) {
    console.log("Dry run. Re-run with --apply to write.");
    return;
  }

  // Children first, session fields last: an interrupted run leaves either no
  // trace (children rolled back below) or the fully updated row.
  const activityRows = draft.activities.map((activity) => ({
    id: crypto.randomUUID(),
    user_id: session.user_id,
    session_id: session.id,
    sequence: activity.sequence,
    modality: activity.modality,
    subtype: activity.subtype,
    objective: activity.objective,
    intensity: activity.intensity,
    duration_seconds: activity.durationSeconds,
    distance_km: activity.distanceKm,
    avg_pace_seconds_per_km: activity.avgPaceSecondsPerKm,
    calories: activity.calories,
    avg_heart_rate_bpm: activity.avgHeartRateBpm,
    max_heart_rate_bpm: activity.maxHeartRateBpm,
    cadence_spm: activity.cadenceSpm,
    elevation_gain_m: activity.elevationGainM,
    avg_power_watts: activity.avgPowerWatts,
    external_load_kg: activity.externalLoadKg,
    details: activity.details,
    notes: activity.notes,
    original_text: activity.originalText,
  }));

  const setRows = draft.activities.flatMap((activity, index) =>
    activity.strengthSets.map((set) => ({
      user_id: session.user_id,
      activity_id: activityRows[index]!.id,
      set_index: set.setIndex,
      exercise_id: set.exercise.slug ? (idBySlug.get(set.exercise.slug) ?? null) : null,
      exercise_raw_text: set.exercise.rawText,
      apparatus: set.exercise.apparatus,
      exercise_confidence: set.exercise.confidence,
      set_type: set.setType,
      reps: set.reps,
      load_value: set.loadValue,
      load_unit: set.loadUnit,
      load_scope: set.loadScope,
      load_kg: set.loadKg,
      side: set.side,
      rir: set.rir,
      rpe: set.rpe,
      tempo: set.tempo,
      rest_seconds: set.restSeconds,
      hold_seconds: set.holdSeconds,
      completed: set.completed,
      notes: set.notes,
      original_text: set.originalText,
    })),
  );

  const intervalRows = draft.activities.flatMap((activity, index) =>
    activity.cardioIntervals.map((interval) => ({
      user_id: session.user_id,
      activity_id: activityRows[index]!.id,
      interval_index: interval.intervalIndex,
      interval_type: interval.intervalType,
      duration_seconds: interval.durationSeconds,
      rest_seconds: interval.restSeconds,
      distance_km: interval.distanceKm,
      pace_seconds_per_km: interval.paceSecondsPerKm,
      split_seconds_per_500m: interval.splitSecondsPer500m,
      speed_value: interval.speedValue,
      speed_unit: interval.speedUnit,
      heart_rate_bpm: interval.heartRateBpm,
      power_watts: interval.powerWatts,
      cadence_spm: interval.cadenceSpm,
      calories: interval.calories,
      notes: interval.notes,
      original_text: interval.originalText,
    })),
  );

  const insertedActivities = await db.from("activities").insert(activityRows);
  if (insertedActivities.error) throw insertedActivities.error;
  try {
    if (setRows.length > 0) {
      const insertedSets = await db.from("strength_sets").insert(setRows);
      if (insertedSets.error) throw insertedSets.error;
    }
    if (intervalRows.length > 0) {
      const insertedIntervals = await db.from("cardio_intervals").insert(intervalRows);
      if (insertedIntervals.error) throw insertedIntervals.error;
    }
    const updated = await db
      .from("workout_sessions")
      .update({ local_date: localDate, title: shortTitle(draft.title) })
      .eq("id", session.id);
    if (updated.error) throw updated.error;
  } catch (error) {
    // Sets cascade from activities, so one delete undoes the children.
    await db
      .from("activities")
      .delete()
      .in(
        "id",
        activityRows.map((row) => row.id),
      );
    throw error;
  }

  console.log(`Applied. Session ${session.id} now has its structure; raw_text is untouched.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
