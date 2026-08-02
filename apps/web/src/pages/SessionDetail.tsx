import type { WorkoutSession } from "@training/db-types";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ActivityDetail, type ActivityWithChildren } from "../components/ActivityDetail.js";
import { SessionEditFields } from "../components/SessionEditForm.js";
import { SourceText } from "../components/SourceText.js";
import {
  EM_DASH,
  formatClock,
  formatLocalDate,
  humanizeEnum,
} from "../components/session-format.js";
import { useBenchmarkDefinitions } from "../lib/history-queries.js";
import { useSession } from "../lib/queries.js";

type SessionTree = WorkoutSession & { activities: ActivityWithChildren[] };

/**
 * One session, rendered from the whole nested tree `useSession` already
 * fetches. Nothing is summarised away: every set, interval, circuit movement
 * and benchmark split the parser produced is on the page, and the source text
 * that produced them sits at the bottom so any of it can be checked.
 */
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const query = useSession(id);
  const benchmarks = useBenchmarkDefinitions();
  const [isEditing, setIsEditing] = useState(false);

  if (query.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (query.isError) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Could not load this session: {(query.error as Error).message}
        </p>
        <Link to="/history" className="text-sm text-sky-400">
          Back to history
        </Link>
      </div>
    );
  }

  const session = query.data as SessionTree | undefined;
  if (!session) return <p className="text-sm text-slate-500">Session not found.</p>;

  const activities = [...(session.activities ?? [])].sort((a, b) => a.sequence - b.sequence);
  const benchmarkNames = new Map(
    (benchmarks.data ?? []).map((definition) => [definition.slug, definition.name]),
  );

  return (
    <div className="space-y-4">
      <Link to="/history" className="text-sm text-sky-400">
        ‹ History
      </Link>

      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold leading-snug">{session.title}</h1>
            <p className="text-sm text-slate-400">
              {formatLocalDate(session.local_date, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
            >
              Edit
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge>{humanizeEnum(session.status)}</Badge>
          <Badge>{humanizeEnum(session.source)}</Badge>
          <Badge>Duration {formatClock(session.duration_seconds)}</Badge>
          <Badge>Session RPE {session.session_rpe ?? EM_DASH}</Badge>
        </div>
      </header>

      {isEditing && <SessionEditFields session={session} onClose={() => setIsEditing(false)} />}

      {session.notes && (
        <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300">
          {session.notes}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          {activities.length} {activities.length === 1 ? "activity" : "activities"}
        </h2>
        {activities.map((activity) => (
          <ActivityDetail key={activity.id} activity={activity} benchmarkNames={benchmarkNames} />
        ))}
      </section>

      <SourceText
        rawText={session.raw_text}
        clientRequestKey={session.client_request_key}
        transcript={session.transcript}
      />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300 tabular-nums">
      {children}
    </span>
  );
}
