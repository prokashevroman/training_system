import { Link } from "react-router-dom";
import type { CalendarSession } from "../lib/history-queries.js";
import { humanizeEnum } from "./session-format.js";

/**
 * Month grid. Weeks start on Monday, matching the athlete's own week and the
 * planning horizon used elsewhere in the app.
 */

export interface CalendarDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** False for the leading/trailing days that only exist to square the grid. */
  inMonth: boolean;
}

/** Local-date arithmetic done on UTC noon so no DST shift can move a day. */
function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function buildMonthGrid(month: string): CalendarDay[][] {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = Date.UTC(year, monthIndex - 1, 1, 12);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  // getUTCDay is 0 for Sunday; shift so Monday is 0.
  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let cell = 0; cell < cellCount; cell += 1) {
    const offset = cell - leading;
    days.push({
      date: isoDate(first + offset * 86_400_000),
      inMonth: offset >= 0 && offset < daysInMonth,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let start = 0; start < days.length; start += 7) weeks.push(days.slice(start, start + 7));
  return weeks;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HistoryCalendar({
  month,
  sessions,
  today,
  onMonthChange,
}: {
  month: string;
  sessions: CalendarSession[];
  today: string;
  onMonthChange: (month: string) => void;
}) {
  const byDate = new Map<string, CalendarSession[]>();
  for (const session of sessions) {
    const bucket = byDate.get(session.local_date);
    if (bucket) bucket.push(session);
    else byDate.set(session.local_date, [session]);
  }

  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm"
          aria-label="Previous month"
        >
          ‹
        </button>
        <p className="text-sm font-medium">{monthLabel}</p>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wide text-slate-500">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {buildMonthGrid(month).map((week) =>
          week.map((day) => {
            const daySessions = byDate.get(day.date) ?? [];
            return (
              <div
                key={day.date}
                className={`min-h-16 rounded-lg border p-1 text-left ${
                  day.inMonth
                    ? "border-slate-800 bg-slate-900/50"
                    : "border-slate-900 bg-slate-950 text-slate-600"
                } ${day.date === today ? "ring-1 ring-sky-500" : ""}`}
              >
                <p
                  className={`text-[10px] tabular-nums ${
                    day.inMonth ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  {Number(day.date.slice(8))}
                </p>
                <div className="space-y-0.5">
                  {daySessions.map((session) => (
                    <Link
                      key={session.id}
                      to={`/sessions/${session.id}`}
                      title={session.title}
                      className="block truncate rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                    >
                      {session.activities[0]
                        ? humanizeEnum(session.activities[0].modality)
                        : session.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <p className="text-xs text-slate-500">
        A cell shows one entry per session, labelled by its first activity. Filters apply to the
        month shown.
      </p>
    </div>
  );
}
