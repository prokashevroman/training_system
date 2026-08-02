import type { Activity, WorkoutSession } from "@training/db-types";
import { Link } from "react-router-dom";

const MODALITY_LABEL: Record<string, string> = {
  strength: "Strength",
  running: "Run",
  cycling: "Bike",
  rowing: "Row",
  ski_erg: "Ski erg",
  swimming: "Swim",
  hybrid_conditioning: "Conditioning",
  mobility_recovery: "Mobility",
  walking_hiking: "Walk / hike",
  sport_outdoor: "Sport",
  dance: "Dance",
  other: "Other",
};

export function SessionCard({
  session,
}: {
  session: WorkoutSession & { activities?: Activity[] };
}) {
  const activities = session.activities ?? [];
  const isImported = session.source === "excel_import";

  return (
    <Link
      to={`/sessions/${session.id}`}
      className="block rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium leading-snug">{session.title}</p>
        {isImported && (
          <span
            className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400"
            title="Imported from the 2026 workbook"
          >
            imported
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {activities.map((a) => (
          <span key={a.id} className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
            {MODALITY_LABEL[a.modality] ?? a.modality}
          </span>
        ))}
      </div>
    </Link>
  );
}
