import { Link } from "react-router-dom";
import { SessionCard } from "../components/SessionCard.js";
import { todayLocalDate, useSessionsOnDate, useTrainingSummary } from "../lib/queries.js";

/**
 * Today: what was done today, plus a small amount of honest context.
 *
 * Deliberately no single "readiness score" — the brief rules that out. Every
 * number shown here is a count you could reproduce by hand from the data.
 */
export function Today() {
  const today = todayLocalDate();
  const sessions = useSessionsOnDate(today);
  const summary = useTrainingSummary();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-sm text-slate-400">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Sessions logged" value={summary.data?.totalSessions ?? "—"} />
        <Stat label="Last 28 days" value={summary.data?.last28Days ?? "—"} />
        <Stat label="Last trained" value={summary.data?.lastTrainedOn ?? "—"} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Today&rsquo;s sessions
        </h2>

        {sessions.isLoading && <p className="text-sm text-slate-500">Loading…</p>}

        {sessions.isError && (
          <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
            Could not load sessions: {(sessions.error as Error).message}
          </p>
        )}

        {sessions.data?.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
            <p className="text-sm text-slate-400">Nothing logged today.</p>
            <Link
              to="/record"
              className="mt-3 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
            >
              Record a session
            </Link>
          </div>
        )}

        {sessions.data?.map((session) => <SessionCard key={session.id} session={session} />)}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}
