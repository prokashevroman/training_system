import { WorkoutDraftSchema } from "@training/ai-contracts";
import { z } from "zod";
import { useMemo } from "react";

/**
 * Review of an AI-produced draft before anything is saved.
 *
 * Two rules from the brief shape this screen. Drafts are never auto-saved, and
 * uncertainty must stay visible: warnings and unconsumed fragments are shown
 * as first-class content, not tucked behind a disclosure, because they are the
 * user's only signal that the model did not understand part of what they said.
 *
 * The response is validated against the shared contract schema here as well as
 * in the Worker. The Worker is a separate deployable that can be rolled
 * independently, so the browser does not assume its output is well formed.
 */
export function DraftReview({ draft, onDiscard }: { draft: unknown; onDiscard: () => void }) {
  // `from-audio` returns the base draft plus a transcript; `from-text` returns
  // the base alone. Parsing against the base with an optional transcript
  // accepts both without branching on which endpoint produced it.
  const parsed = useMemo(
    () => WorkoutDraftSchema.extend({ transcript: z.string().optional() }).safeParse(draft),
    [draft],
  );

  if (!parsed.success) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Draft could not be read</h1>
        <p className="text-sm text-slate-400">
          The AI worker returned something that does not match the shared schema, so nothing has
          been saved. Enter the session manually instead.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-400">
          {JSON.stringify(parsed.error.issues.slice(0, 5), null, 2)}
        </pre>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
        >
          Back
        </button>
      </div>
    );
  }

  const result = parsed.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Review draft</h1>
        <p className="text-sm text-slate-400">
          Nothing is saved yet. Check what was understood, then save or discard.
        </p>
      </header>

      {result.transcript && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-xs uppercase tracking-wide text-slate-400">Transcript</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{result.transcript}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-400">
          Detected sessions ({result.sessions.length})
        </h2>
        {result.sessions.map((session, i) => (
          <article key={i} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="font-medium">{session.title}</p>
            <p className="text-xs text-slate-400">{session.localDate}</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {session.activities.map((activity, j) => (
                <li key={j}>
                  {activity.modality}
                  {activity.distanceKm !== null && ` · ${activity.distanceKm} km`}
                  {activity.durationSeconds !== null &&
                    ` · ${Math.round(activity.durationSeconds / 60)} min`}
                  {activity.strengthSets.length > 0 && ` · ${activity.strengthSets.length} sets`}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {result.warnings.length > 0 && (
        <section className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4">
          <h2 className="text-xs uppercase tracking-wide text-amber-300">
            Uncertainties ({result.warnings.length})
          </h2>
          <ul className="mt-2 space-y-2 text-sm text-amber-100">
            {result.warnings.map((warning, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-amber-400">{warning.code}</span>{" "}
                {warning.message}
                {warning.sourceFragment && (
                  <span className="block text-xs text-amber-300/70">
                    “{warning.sourceFragment}”
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.unconsumedFragments.length > 0 && (
        <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-xs uppercase tracking-wide text-slate-400">
            Not understood ({result.unconsumedFragments.length})
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            These parts of what you said produced no structured record.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {result.unconsumedFragments.map((fragment, i) => (
              <li key={i} className="font-mono text-xs">
                {fragment.text}
                <span className="ml-2 font-sans text-slate-500">{fragment.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled
          title="Saving a voice draft lands with the live Worker"
          className="cursor-not-allowed rounded-lg bg-sky-600/40 px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
        >
          Discard
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Saving is disabled until the Worker has been exercised against a real Cloudflare account —
        the draft shape is validated here, but writing unverified AI output to real training history
        is exactly what the architecture is meant to prevent.
      </p>
    </div>
  );
}
