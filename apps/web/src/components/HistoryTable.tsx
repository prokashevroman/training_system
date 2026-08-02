import { Link } from "react-router-dom";
import type { SessionWithActivities } from "../lib/queries.js";
import {
  EM_DASH,
  formatClock,
  formatDistance,
  formatLocalDate,
  humanizeEnum,
} from "./session-format.js";

/**
 * The desktop view: one row per session, `hidden md:table` so phones get the
 * card list instead. Distance is summed across a session's activities only
 * when at least one of them recorded a distance — a session of pure lifting
 * shows an em dash rather than 0 km.
 */
export function HistoryTable({ sessions }: { sessions: SessionWithActivities[] }) {
  return (
    <table className="hidden w-full border-collapse text-sm md:table">
      <thead>
        <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
          <Th>Date</Th>
          <Th>Session</Th>
          <Th>Modalities</Th>
          <Th>Objectives</Th>
          <Th className="text-right">Distance</Th>
          <Th className="text-right">Duration</Th>
          <Th className="text-right">RPE</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => {
          const activities = session.activities ?? [];
          const distances = activities
            .map((a) => a.distance_km)
            .filter((km): km is number => km !== null);
          const durations = activities
            .map((a) => a.duration_seconds)
            .filter((s): s is number => s !== null);
          const duration =
            session.duration_seconds ??
            (durations.length ? durations.reduce((a, b) => a + b, 0) : null);

          return (
            <tr key={session.id} className="border-b border-slate-800/60 align-top">
              <Td className="whitespace-nowrap tabular-nums text-slate-400">
                {formatLocalDate(session.local_date)}
              </Td>
              <Td>
                <Link to={`/sessions/${session.id}`} className="text-sky-400 hover:underline">
                  {session.title}
                </Link>
              </Td>
              <Td className="text-slate-300">
                {activities.map((a) => humanizeEnum(a.modality)).join(", ") || EM_DASH}
              </Td>
              <Td className="text-slate-400">
                {[...new Set(activities.map((a) => humanizeEnum(a.objective)))].join(", ") ||
                  EM_DASH}
              </Td>
              <Td className="text-right tabular-nums">
                {distances.length ? formatDistance(distances.reduce((a, b) => a + b, 0)) : EM_DASH}
              </Td>
              <Td className="text-right tabular-nums">{formatClock(duration)}</Td>
              <Td className="text-right tabular-nums">{session.session_rpe ?? EM_DASH}</Td>
              <Td className="text-slate-400">
                {humanizeEnum(session.status)}
                {session.source === "excel_import" && (
                  <span className="ml-1 text-xs text-slate-500">(imported)</span>
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
