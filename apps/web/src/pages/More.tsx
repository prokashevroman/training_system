import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth.js";
import { todayLocalDate } from "../lib/queries.js";
import { fetchSessionExport } from "../lib/record-queries.js";

/**
 * More: account, the import review queue, and a way out with your data.
 *
 * The export is plain JSON of the rows as stored — no reshaping — so it can be
 * diffed against the database and is useful as a backup rather than only as a
 * report.
 */
export function More() {
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onExport() {
    setBusy(true);
    setError(null);
    try {
      const sessions = await fetchSessionExport();
      const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `training-log-${todayLocalDate()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">More</h1>
        <p className="text-sm text-slate-400">{session?.user.email ?? "Not signed in"}</p>
      </header>

      <section className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
        <Link to="/import-review" className="block px-4 py-3 text-sm hover:bg-slate-900">
          Import review
          <span className="block text-xs text-slate-400">
            Workbook cells the parser flagged, with their source text.
          </span>
        </Link>

        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-900 disabled:opacity-50"
        >
          {busy ? "Preparing export…" : "Export sessions as JSON"}
          <span className="block text-xs text-slate-400">
            Every session with its activities, sets and intervals.
          </span>
        </button>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          Export failed: {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300"
      >
        Sign out
      </button>
    </div>
  );
}
