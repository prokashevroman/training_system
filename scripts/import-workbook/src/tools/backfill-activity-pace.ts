import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractLeadingDate } from "@training/domain";
import { parseCell } from "../parse.js";

/**
 * Backfill `activities.avg_pace_seconds_per_km` from each session's own
 * `raw_text` (migration 0013).
 *
 * The parser always read `5:50 per km`, but until 2026-09 the activity had no
 * pace field, so the value was dropped on write. `raw_text` is the column the
 * schema promises every record stays re-derivable from — this tool is that
 * promise being kept: it re-runs the same deterministic parser over every
 * session that has activities but no pace, and fills in ONLY the pace, matching
 * activities by their sequence. Nothing else is touched, so a hand-edited
 * title or date survives.
 *
 * Dry-run by default, like the importer:
 *
 *   npx tsx src/tools/backfill-activity-pace.ts
 *   npx tsx src/tools/backfill-activity-pace.ts --apply
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

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

interface SessionRow {
  id: string;
  local_date: string;
  title: string;
  raw_text: string;
  activities: { id: string; sequence: number; avg_pace_seconds_per_km: number | null }[];
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const db: SupabaseClient = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const found = await db
    .from("workout_sessions")
    .select("id, local_date, title, raw_text, activities(id, sequence, avg_pace_seconds_per_km)")
    .neq("raw_text", "")
    .order("local_date");
  if (found.error) throw found.error;

  let updates = 0;
  let scanned = 0;
  for (const session of (found.data ?? []) as SessionRow[]) {
    if (session.activities.length === 0) continue;
    if (session.activities.every((a) => a.avg_pace_seconds_per_km !== null)) continue;
    scanned += 1;

    const dated = extractLeadingDate(session.raw_text, todayLocalDate());
    const parsed = parseCell({
      sheet: "backfill",
      row: 1,
      col: 1,
      localDate: dated.localDate ?? session.local_date,
      rawText: dated.rest,
    });

    // One session row maps onto one parsed session; a text that splits into
    // several (paste batches store the whole paste per session) cannot be
    // matched by sequence safely, so it is skipped and reported instead.
    if (parsed.sessions.length !== 1) {
      if (
        parsed.sessions.some((s) => s.activities.some((a) => a.avgPaceSecondsPerKm !== null))
      ) {
        console.log(
          `skip ${session.local_date} "${session.title}" — parses into ${parsed.sessions.length} sessions; fix by hand if a pace is expected`,
        );
      }
      continue;
    }

    const bySequence = new Map(
      parsed.sessions[0]!.activities.map((a) => [a.sequence, a.avgPaceSecondsPerKm]),
    );
    for (const activity of session.activities) {
      if (activity.avg_pace_seconds_per_km !== null) continue;
      const pace = bySequence.get(activity.sequence) ?? null;
      if (pace === null) continue;
      updates += 1;
      console.log(
        `${session.local_date} "${session.title}" activity ${activity.sequence}: avg pace -> ${pace}s/km`,
      );
      if (apply) {
        const updated = await db
          .from("activities")
          .update({ avg_pace_seconds_per_km: pace })
          .eq("id", activity.id);
        if (updated.error) throw updated.error;
      }
    }
  }

  console.log(
    `${scanned} sessions scanned, ${updates} paces ${apply ? "written" : "to write (dry run — re-run with --apply)"}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
