import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivityDraft } from "../../../../../packages/domain/src/activity.js";
import { isWorkerConfigured } from "../../lib/ai-worker.js";
import {
  extractLeadingDate,
  groupSetsForPreview,
  newEntryBatchKey,
  parsePastedText,
  useNormalizeEntry,
  useSavePastedSessions,
  type EntryOrigin,
  type PastedSession,
} from "../../lib/paste-queries.js";
import { formatLoad, todayLocalDate, useExerciseLibrary } from "../../lib/queries.js";
import { newVoiceRequestKey, useSaveNoteSession } from "../../lib/record-queries.js";
import { voiceSessionTitle } from "../../lib/voice-title.js";
import { enumLabel } from "./labels.js";
import { ExerciseLibraryDatalist } from "./ExerciseSelect.js";

/**
 * Structured entry from text — the one screen between any text (spoken, typed,
 * pasted) and the database.
 *
 * The athlete's job is: read the preview, tap Save. Everything else is
 * automatic. The deterministic parser runs on every keystroke; when it cannot
 * claim the text and the AI worker is configured, ONE rewrite into notation is
 * requested automatically and re-parsed. `raw_text` always stores the original
 * words, so nothing the model writes is ever persisted — and nothing the
 * parser reads is ever refused: sets, intervals, circuits and benchmarks all
 * have tables now.
 *
 * The preview stays because it is the honesty layer, not a form to fill in:
 * what became structured data, what was assumed, and which lines produced no
 * structure (they are still saved, inside the session text).
 */

const CONTROL =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

const PLACEHOLDER = `31.08:
Single-arm cable rear-delt fly 3 sets x12 reps each arm (7.5kg) too light
Weighted strict pull-up: 4x5 (5kg)
Fast intervals pace: 4:09 - 3:58 - 3:55 - 4:04

Bike to & from work`;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `249` → `4:09`. Seconds formatted as m:ss for paces and short durations. */
function formatSeconds(total: number): string {
  const rounded = Math.round(total);
  return `${Math.floor(rounded / 60)}:${pad2(rounded % 60)}`;
}

export function PasteEntryForm({
  onCancel,
  initialText = "",
  origin = "manual",
}: {
  onCancel: () => void;
  /** Pre-filled text, e.g. a voice transcript handed over for structuring. */
  initialText?: string;
  /** How the text entered the system; stamped on every saved session. */
  origin?: EntryOrigin["source"];
}) {
  const navigate = useNavigate();
  const save = useSavePastedSessions();
  const saveNote = useSaveNoteSession();
  const tidy = useNormalizeEntry();
  const exercises = useExerciseLibrary();

  const [text, setText] = useState(initialText);
  const [localDate, setLocalDate] = useState(todayLocalDate);
  // Minted once per entry, not per save attempt, so a double-tap on Save cannot
  // write the same sessions twice. The note key is separate: saving as a note
  // is a different record than saving structured.
  const [batchKey, setBatchKey] = useState(() => newEntryBatchKey(origin));
  const [noteKey] = useState(() =>
    origin === "voice" ? newVoiceRequestKey() : `manual:${crypto.randomUUID()}`,
  );
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  /** The box content the moment the AI rewrite replaced it. Null = no rewrite. */
  const [preRewrite, setPreRewrite] = useState<string | null>(null);
  /** The last text the automatic rewrite was attempted on; never retried. */
  const [autoAttempted, setAutoAttempted] = useState<string | null>(null);

  /**
   * What `raw_text` must preserve: the transcript for a voice entry, otherwise
   * the pre-rewrite text when a rewrite ran, otherwise the box itself.
   */
  const verbatim = origin === "voice" ? initialText : (preRewrite ?? text);

  // A leading `31.08:` is a date, not training. It moves to the date field and
  // out of the parser's sight; `raw_text` still keeps it via `verbatim`.
  const dated = useMemo(() => extractLeadingDate(text, todayLocalDate()), [text]);
  const [appliedAutoDate, setAppliedAutoDate] = useState<string | null>(null);
  useEffect(() => {
    if (dated.localDate !== null && dated.localDate !== appliedAutoDate) {
      setLocalDate(dated.localDate);
      setAppliedAutoDate(dated.localDate);
    }
  }, [dated.localDate, appliedAutoDate]);

  const parsed = useMemo(
    () =>
      parsePastedText(dated.rest, localDate, batchKey, {
        source: origin,
        rawText: verbatim,
        transcript: origin === "voice" ? initialText : null,
      }),
    [dated.rest, localDate, batchKey, origin, verbatim, initialText],
  );

  /** The parser needs help: nothing structured, or lines it could not claim. */
  const wantsRewrite =
    text.trim() !== "" && (parsed.sessions.length === 0 || parsed.unconsumedLines.length > 0);

  async function runTidy() {
    const result = await tidy.mutateAsync({
      text: dated.rest,
      todayLocalDate: todayLocalDate(),
    });
    if (preRewrite === null) setPreRewrite(text);
    setText(result.notation);
    // A date stated in the text wins; the model's date fills in only when the
    // deterministic extractor found none.
    const nextDate = dated.localDate ?? result.localDate;
    if (nextDate !== null) {
      setLocalDate(nextDate);
      setAppliedAutoDate(nextDate);
    }
  }

  // The automatic rewrite: fires once per entry, after typing pauses, only
  // when the parser left something unread and no rewrite has run yet. The
  // athlete does nothing; a failure surfaces below and is never retried
  // silently (the manual button remains).
  useEffect(() => {
    if (!isWorkerConfigured() || !wantsRewrite) return;
    if (preRewrite !== null || tidy.isPending) return;
    if (dated.rest.trim() === "" || autoAttempted === dated.rest) return;
    const input = dated.rest;
    const timer = setTimeout(() => {
      setAutoAttempted(input);
      void runTidy().catch(() => undefined);
    }, 900);
    return () => clearTimeout(timer);
  }, [dated.rest, wantsRewrite, preRewrite, autoAttempted, tidy.isPending]);

  function onUndoRewrite() {
    if (preRewrite !== null) setText(preRewrite);
    setPreRewrite(null);
    tidy.reset();
  }

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
   * Why Save is unavailable, or null when it is fine. Only two causes remain:
   * a draft part with no table (tags — never produced today), and an exercise
   * library that has not loaded, which would silently drop canonical links.
   */
  const blockedReason =
    parsed.unsupported.length > 0
      ? "Part of this parse has no table yet, so it will not be saved half-missing."
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
    // Several sessions came out of one entry; History is where they read as a
    // day rather than as one record.
    setText("");
    setTitles({});
    setPicks({});
    setPreRewrite(null);
    setBatchKey(newEntryBatchKey(origin));
    navigate("/history");
  }

  async function onSaveNote() {
    const result = await saveNote.mutateAsync({
      text: verbatim,
      title: voiceSessionTitle(verbatim),
      localDate,
      requestKey: noteKey,
      source: origin,
    });
    navigate(`/sessions/${result.sessionId}`);
  }

  const busy = save.isPending || saveNote.isPending;

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
        {dated.localDate !== null && (
          <span className="mt-1 block text-xs text-slate-500">
            Read from the first line of the text. Change it here if that is wrong.
          </span>
        )}
      </label>

      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
          {origin === "voice" ? "Your transcript" : "Your text"}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={PLACEHOLDER}
          className={`${CONTROL} font-mono leading-relaxed`}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Write it however it comes out. The preview below shows how it was read; anything
          unreadable is tidied automatically{isWorkerConfigured() ? "" : " when AI is configured"}
          , and your exact words are stored with the session either way.
        </span>
      </label>

      {isWorkerConfigured() && text.trim() !== "" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {/* The rewrite also fires automatically when the parser leaves
                unread lines; the button stays so it can be invoked (or re-run)
                at will — removing it once was a mistake. */}
            <button
              type="button"
              onClick={() => void runTidy().catch(() => undefined)}
              disabled={tidy.isPending}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                wantsRewrite
                  ? "border-sky-700 bg-sky-950/40 text-sky-200"
                  : "border-slate-700 text-slate-300"
              } disabled:opacity-50`}
            >
              {tidy.isPending ? "Rewriting…" : "Tidy with AI"}
            </button>
            {preRewrite !== null && !tidy.isPending && (
              <button
                type="button"
                onClick={onUndoRewrite}
                className="text-xs text-slate-400 underline"
              >
                Undo — back to your words
              </button>
            )}
            <span className="text-xs text-slate-500">
              {tidy.isPending
                ? "Structuring what the parser could not read…"
                : preRewrite !== null
                  ? "Rewritten into notation. Your original text is what gets stored verbatim."
                  : "Rewrites chaotic text into lines the parser reads. Your original words are kept either way."}
            </span>
          </div>
          {tidy.error && (
            <p role="alert" className="text-sm text-rose-400">
              The AI rewrite failed: {tidy.error.message}
            </p>
          )}
        </div>
      )}

      {text.trim() !== "" && (
        <Preview
          parsed={parsed}
          sessions={sessions}
          picks={picks}
          onTitle={(index, value) => setTitles({ ...titles, [index]: value })}
          onPick={(rawText, value) => setPicks({ ...picks, [rawText]: value })}
        />
      )}

      {(save.error ?? saveNote.error) && (
        <p role="alert" className="text-sm text-rose-400">
          {(save.error ?? saveNote.error)?.message}
        </p>
      )}

      {blockedReason && <p className="text-xs text-slate-500">{blockedReason}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={parsed.sessions.length === 0 || busy || blockedReason !== null}
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
          disabled={busy}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
        >
          Cancel
        </button>
        {text.trim() !== "" && (
          <button
            type="button"
            onClick={() => void onSaveNote()}
            disabled={busy}
            className="text-xs text-slate-400 underline disabled:opacity-50"
          >
            {saveNote.isPending ? "Saving note…" : "Save as plain note instead"}
          </button>
        )}
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
        Nothing structured came out of that text yet
        {isWorkerConfigured() ? " — the automatic rewrite will have a go" : ""}. It can always be
        saved as a plain note below.
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-slate-200">
        {parsed.sessions.length === 1 ? "1 session" : `${parsed.sessions.length} sessions`}
        {parsed.setCount > 0 &&
          ` · ${parsed.setCount} ${parsed.setCount === 1 ? "set" : "sets"}`}
      </h2>

      {parsed.unsupported.length > 0 && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3">
          <p className="text-sm text-rose-200">
            Part of this parse has no table yet, so saving is paused rather than losing it:
          </p>
          <ul className="mt-2 space-y-1 text-xs text-rose-100/80">
            {parsed.unsupported.map(({ sessionIndex, parts }) => (
              <li key={sessionIndex}>
                <span className="text-rose-200">
                  {sessions[sessionIndex]?.title ?? `Session ${sessionIndex + 1}`}
                </span>{" "}
                — {parts.join(", ")}.
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
            <ActivityPreview key={activityIndex} activity={activity} />
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

/** One activity: sets, intervals, a circuit or a benchmark — whatever it has. */
function ActivityPreview({ activity }: { activity: ActivityDraft }) {
  const hasStructure =
    activity.strengthSets.length > 0 ||
    activity.cardioIntervals.length > 0 ||
    activity.circuit !== null ||
    activity.benchmark !== null;

  return (
    <div className="mt-3">
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

        {activity.cardioIntervals.length > 0 && (
          <li className="text-sm text-slate-200">
            {activity.cardioIntervals.length}{" "}
            {activity.cardioIntervals.length === 1 ? "interval" : "intervals"}
            <span className="text-slate-400">
              {" — "}
              {activity.cardioIntervals
                .map((interval) =>
                  interval.paceSecondsPerKm !== null
                    ? `${formatSeconds(interval.paceSecondsPerKm)} /km`
                    : interval.durationSeconds !== null
                      ? formatSeconds(interval.durationSeconds)
                      : interval.distanceKm !== null
                        ? `${interval.distanceKm} km`
                        : "—",
                )
                .join(", ")}
            </span>
          </li>
        )}

        {activity.circuit !== null && (
          <li className="text-sm text-slate-200">
            {activity.circuit.name ?? "Circuit"}
            <span className="text-slate-400">
              {activity.circuit.roundsPrescribed !== null &&
                ` — ${activity.circuit.roundsPrescribed} rounds`}
              {activity.circuit.movements.length > 0 &&
                `: ${activity.circuit.movements
                  .map((movement) => movement.exercise.rawText)
                  .join(", ")}`}
            </span>
          </li>
        )}

        {activity.benchmark !== null && (
          <li className="text-sm text-slate-200">
            Benchmark {activity.benchmark.definitionSlug}
            <span className="text-slate-400">
              {activity.benchmark.totalSeconds !== null &&
                ` — ${formatSeconds(activity.benchmark.totalSeconds)}`}
              {activity.benchmark.splits.length > 0 &&
                ` · ${activity.benchmark.splits.length} splits`}
            </span>
          </li>
        )}

        {!hasStructure && <li className="text-sm text-slate-400">{activity.originalText}</li>}
        {activity.notes !== null && hasStructure && (
          <li className="text-xs text-slate-500">{activity.notes}</li>
        )}
      </ul>
    </div>
  );
}
