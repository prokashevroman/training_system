import { useState } from "react";
import { HistoryCalendar } from "../components/HistoryCalendar.js";
import { HistoryFilterPanel } from "../components/HistoryFilterPanel.js";
import { HistoryTable } from "../components/HistoryTable.js";
import { SessionCard } from "../components/SessionCard.js";
import { formatLocalDate } from "../components/session-format.js";
import {
  EMPTY_HISTORY_FILTERS,
  HISTORY_PAGE_SIZE,
  countActiveFilters,
  useHistoryMonth,
  useHistorySessions,
  type HistoryFilters,
} from "../lib/history-queries.js";
import type { SessionWithActivities } from "../lib/queries.js";
import { todayLocalDate } from "../lib/queries.js";

type View = "list" | "calendar" | "table";

/**
 * History: the whole log, filtered in Postgres.
 *
 * List and table share one paginated query; the calendar runs its own
 * month-bounded query. Only the visible view is fetched, so switching views
 * costs one request rather than keeping three in flight.
 */
export function History() {
  const today = todayLocalDate();
  const [view, setView] = useState<View>("list");
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_HISTORY_FILTERS);
  const [month, setMonth] = useState(today.slice(0, 7));

  const isCalendar = view === "calendar";
  const paged = useHistorySessions(filters, !isCalendar);
  const calendar = useHistoryMonth(filters, month, isCalendar);

  const sessions = paged.data?.pages.flatMap((page) => page.sessions) ?? [];
  const total = paged.data?.pages[0]?.total ?? 0;
  const activeCount = countActiveFilters(filters);
  const error = (isCalendar ? calendar.error : paged.error) as Error | null;
  const isLoading = isCalendar ? calendar.isLoading : paged.isLoading;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">History</h1>
          <p className="text-sm text-slate-400">
            {isCalendar
              ? `${calendar.data?.length ?? 0} sessions this month`
              : `${total} session${total === 1 ? "" : "s"}${activeCount ? " matching" : ""}`}
          </p>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_HISTORY_FILTERS)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300"
          >
            Clear filters
          </button>
        )}
      </header>

      <div className="flex gap-1.5" role="group" aria-label="View">
        <ViewButton current={view} value="list" onSelect={setView}>
          List
        </ViewButton>
        <ViewButton current={view} value="calendar" onSelect={setView}>
          Calendar
        </ViewButton>
        {/* The table needs the width; phones stay on cards. */}
        <ViewButton current={view} value="table" onSelect={setView} className="hidden md:block">
          Table
        </ViewButton>
      </div>

      <HistoryFilterPanel filters={filters} onChange={setFilters} />

      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      {error && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Could not load history: {error.message}
        </p>
      )}

      {isCalendar ? (
        <HistoryCalendar
          month={month}
          today={today}
          sessions={calendar.data ?? []}
          onMonthChange={setMonth}
        />
      ) : (
        <>
          {!isLoading && sessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
              <p className="text-sm text-slate-400">
                {activeCount > 0 ? "No session matches these filters." : "No sessions logged yet."}
              </p>
            </div>
          )}

          {view === "table" ? (
            <>
              <HistoryTable sessions={sessions} />
              {/* The table itself is `hidden md:table`; a narrowed window still
                  gets the same rows as cards rather than an empty screen. */}
              <div className="md:hidden">
                <DayGroupedList sessions={sessions} />
              </div>
            </>
          ) : (
            <DayGroupedList sessions={sessions} />
          )}

          {paged.hasNextPage && (
            <button
              type="button"
              onClick={() => void paged.fetchNextPage()}
              disabled={paged.isFetchingNextPage}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-300 disabled:opacity-50"
            >
              {paged.isFetchingNextPage
                ? "Loading…"
                : `Load ${Math.min(HISTORY_PAGE_SIZE, total - sessions.length)} more of ${total}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Sessions arrive ordered by date, so a day heading only needs to appear when
 * the date changes. It also makes a two-session day — a lift and a commute —
 * read as one day rather than two unrelated cards.
 */
function DayGroupedList({ sessions }: { sessions: SessionWithActivities[] }) {
  const groups: { date: string; sessions: SessionWithActivities[] }[] = [];
  for (const session of sessions) {
    const last = groups.at(-1);
    if (last && last.date === session.local_date) last.sessions.push(session);
    else groups.push({ date: session.local_date, sessions: [session] });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.date} className="space-y-2">
          <h2 className="flex items-baseline justify-between text-sm font-medium text-slate-400">
            <span>
              {formatLocalDate(group.date, {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            {group.sessions.length > 1 && (
              <span className="text-xs text-slate-500">{group.sessions.length} sessions</span>
            )}
          </h2>
          {group.sessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ViewButton({
  current,
  value,
  onSelect,
  className = "",
  children,
}: {
  current: View;
  value: View;
  onSelect: (view: View) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const isOn = current === value;
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={() => onSelect(value)}
      className={`rounded-lg px-3 py-1.5 text-sm transition ${
        isOn ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      } ${className}`}
    >
      {children}
    </button>
  );
}
