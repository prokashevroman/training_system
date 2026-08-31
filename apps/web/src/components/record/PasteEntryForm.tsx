import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  groupSetsForPreview,
  newPasteRequestKey,
  parsePastedText,
  useSavePastedSessions,
  type PastedSession,
} from "../../lib/paste-queries.js";
import { formatLoad, todayLocalDate, useExerciseLibrary } from "../../lib/queries.js";
import { enumLabel } from "./labels.js";
import { ExerciseLibraryDatalist } from "./ExerciseSelect.js";

/**
 * Paste entry: write a session the way it is written in the spreadsheet, and
 * let the importer's parser map it onto the tables.
 *
 * The preview is the whole point of the screen. It re-parses on every keystroke
 * and shows three things the athlete has to be able to see *before* saving:
 * what became structured data, what the parser assumed (each warning), and
 * which lines it could not claim. Nothing is guessed silently, and the pasted
 * text is stored verbatim regardless, so a line the parser missed is still on
 * the record.
 */

const CONTROL =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

const PLACEHOLDER = `Single-arm cable rear-delt fly 3 sets x12 reps each arm (7.5kg) too light
Weighted strict pull-up: 4x5 (5kg)
Seated cable row, 3x10 (45kg)

Bike to & from work`;

export function PasteEntryForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const save = useSavePastedSessions();
  const exercises = useExerciseLibrary();

  const [text, setText] = useState("");
  const [localDate, setLocalDate] = useState(todayLocalDate);
  // Minted once per paste, not per save attempt, so a double-tap on Save cannot
  // write the same sessions twice.
  const [batchKey, setBatchKey] = useState(newPasteRequestKey);
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});

  const parsed = useMemo(
    () => parsePastedText(text, localDate, batchKey),
    [text, localDate, batchKey],
  );

  const slugByName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.name.trim().toLowerCase(), e.slug])),
    [exercises.data],
  );

  /** Only the picks that actually name a library exercise become links. */
  const slugByRawText = useMemo(() => {
    const resolved = new Map<string, string>();
    for (const [rawText, typedName] of Object.entries(picks)) {
      const slug = slugByName.get(typedName.trim().toLowerCase());
      if (slug) resolved.set(rawText, slug);
    }
    return resolved;
  }, [picks, slugByName]);

  const sessions: PastedSession[] = parsed.sessions.map((session, index) => ({
    ...session,
    title: titles[index] ?? session.title,
  }));

  /**
   * Why Save is unavailable, or null when it is fine. Both cases would
   * otherwise write a record that quietly lost something: an unlinked exercise
   * whose slug the parser did resolve, or a benchmark with no splits.
   */
  const blockedReason =
    parsed.unsupported.length > 0
      ? "Paste entry cannot store everything in this text yet — see the note above. Manual entry can."
      : !exercises.isSuccess && parsed.setCount > 0
        ? exercises.isError
          ? "The exercise library could not be loaded, so these lifts cannot be linked to it. Reload and try again."
          : "Waiting for the exercise library, so the exercises can be linked to it…"
        : null;

  async function onSave() {
    const result = await save.mutateAsync({ sessions, slugByRawText });
    if (result.sessionIds.length === 1 && result.sessionIds[0]) {
      navigate(`/sessions/${result.sessionIds[0]}`);
      return;
    }
    // Several sessions came out of one paste; History is where they read as a
    // day rather than as one record.
    setText("");
    setTitles({});
    setPicks({});
    setBatchKey(newPasteRequestKey());
    navigate("/history");
  }

  return (
    <div className="space-y-5">
      <ExerciseLibraryDatalist />

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Date</span>
        <input
          type="date"
          value={localDate}
          onChange={(e) => setLocalDate(e.target.value)}
          className={`${CONTROL} max-w-xs`}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
          Paste your lines
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={PLACEHOLDER}
          className={`${CONTROL} font-mono leading-relaxed`}
        />
        <span className="mt-1 block text-xs text-slate-500">
          One exercise per line, exactly as you write it in the spreadsheet. Lifting stays one
          session even across a blank line; a commute or a named benchmark becomes its own. The
          preview below shows how it was read.
        </span>
      </label>

      {text.trim() !== "" && (
        <Preview
          parsed={parsed}
          sessions={sessions}
          picks={picks}
          onTitle={(index, value) => setTitles({ ...titles, [index]: value })}
          onPick={(rawText, value) => setPicks({ ...picks, [rawText]: value })}
        />
      )}

      {save.error && (
        <p role="alert" className="text-sm text-rose-400">
          {save.error.message}
        </p>
      )}

      {blockedReason && <p className="text-xs text-slate-500">{blockedReason}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={parsed.sessions.length === 0 || save.isPending || blockedReason !== null}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {save.isPending
            ? "Saving…"
            : `Save ${parsed.sessions.length || ""} ${
                parsed.sessions.length === 1 ? "session" : "sessions"
              }`.trim()}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface PreviewProps {
  parsed: ReturnType<typeof parsePastedText>;
  sessions: PastedSession[];
  picks: Record<string, string>;
  onTitle: (index: number, value: string) => void;
  onPick: (rawText: string, value: string) => void;
}

function Preview({ parsed, sessions, picks, onTitle, onPick }: PreviewProps) {
  if (parsed.sessions.length === 0) {
    return (
      <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
        Nothing structured came out of that text yet. It can still be saved from the Record screen
        as a plain note.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-200">
        {parsed.sessions.length === 1 ? "1 session" : `${parsed.sessions.length} sessions`} ·{" "}
        {parsed.setCount} {parsed.setCount === 1 ? "set" : "sets"}
      </h2>

      {parsed.unsupported.length > 0 && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3">
          <p className="text-sm text-rose-200">
            Paste entry cannot store all of this yet, so it will not save a version of it that is
            missing pieces.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-rose-100/80">
            {parsed.unsupported.map(({ sessionIndex, parts }) => (
              <li key={sessionIndex}>
                <span className="text-rose-200">
                  {sessions[sessionIndex]?.title ?? `Session ${sessionIndex + 1}`}
                </span>{" "}
                — {parts.join(", ")}. Intervals, circuits and benchmark splits live in tables this
                screen does not write yet; the workbook importer and manual entry do.
              </li>
            ))}
          </ul>
        </div>
      )}

      {sessions.map((session, index) => (
        <article key={index} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Title</span>
            <input
              type="text"
              value={session.title}
              onChange={(e) => onTitle(index, e.target.value)}
              className={CONTROL}
            />
          </label>

          {session.draft.activities.map((activity, activityIndex) => (
            <div key={activityIndex} className="mt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {enumLabel(activity.modality)}
                {activity.objective !== "unknown" && ` · ${enumLabel(activity.objective)}`}
              </p>
              <ul className="mt-1 space-y-1">
                {groupSetsForPreview(activity.strengthSets).map((group, groupIndex) => (
                  <li key={groupIndex} className="text-sm text-slate-200">
                    <span className={group.slug === null ? "text-amber-300" : undefined}>
                      {group.exerciseRawText}
                    </span>
                    <span className="text-slate-400">
                      {" — "}
                      {group.setCount} × {group.reps ?? "?"}
                      {group.loadValue !== null && (
                        <>
                          {" @ "}
                          {formatLoad({
                            load_value: group.loadValue,
                            load_unit: group.loadUnit,
                            load_scope: group.loadScope,
                            load_kg: group.loadKg,
                          })}
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {activity.strengthSets.length === 0 && (
                  <li className="text-sm text-slate-400">{activity.originalText}</li>
                )}
              </ul>
            </div>
          ))}
        </article>
      ))}

      {parsed.unresolvedExercises.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <p className="text-sm text-slate-300">
            Not in the exercise library. Saving keeps the text exactly as written; linking one is
            optional and only adds the canonical reference.
          </p>
          <div className="mt-2 space-y-2">
            {parsed.unresolvedExercises.map((rawText) => (
              <label key={rawText} className="block">
                <span className="mb-1 block text-xs text-amber-300">{rawText}</span>
                <input
                  type="text"
                  list="exercise-library"
                  autoComplete="off"
                  value={picks[rawText] ?? ""}
                  onChange={(e) => onPick(rawText, e.target.value)}
                  placeholder="Link to an exercise (optional)"
                  className={CONTROL}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {parsed.warnings.length > 0 && (
        <details className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <summary className="cursor-pointer text-sm text-slate-300">
            {parsed.warnings.length} {parsed.warnings.length === 1 ? "assumption" : "assumptions"}{" "}
            worth checking
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {parsed.warnings.map((warning, index) => (
              <li key={index}>
                <code className="text-slate-500">{warning.code}</code> {warning.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {parsed.unconsumedLines.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3">
          <p className="text-sm text-amber-200">
            No structure was read from{" "}
            {parsed.unconsumedLines.length === 1
              ? "this line"
              : `these ${parsed.unconsumedLines.length} lines`}
            . They are still saved with the session text.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
            {parsed.unconsumedLines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
