import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { todayLocalDate } from "../../lib/queries.js";
import { newVoiceRequestKey, useSaveVoiceSession } from "../../lib/record-queries.js";
import { voiceSessionTitle } from "../../lib/voice-title.js";

/**
 * The tap between a transcript and the database.
 *
 * The text on screen is exactly what enters the system, so the review is:
 * read it, fix anything Whisper misheard, then either structure it into
 * sessions and sets (the default path — it goes through the same parser
 * preview as pasted text, and the transcript is stored verbatim alongside) or
 * save it as a plain note.
 */
export function TranscriptConfirm({
  transcript,
  onStructure,
  onDone,
  onDiscard,
}: {
  transcript: string;
  /** Hands the (possibly corrected) transcript to the structured-entry flow. */
  onStructure: (text: string) => void;
  onDone: () => void;
  onDiscard: () => void;
}) {
  const [text, setText] = useState(transcript);
  const [title, setTitle] = useState(() => voiceSessionTitle(transcript));
  // Minted once per recording: a Save double-tap must not create two sessions.
  const requestKey = useMemo(() => newVoiceRequestKey(), []);
  const localDate = useMemo(() => todayLocalDate(), []);
  const save = useSaveVoiceSession();

  if (save.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Saved</h1>
        <p className="rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
          {save.data.wasDuplicate
            ? "Already saved — this tap matched a session that was written a moment ago."
            : "Session saved."}{" "}
          <Link to={`/sessions/${save.data.sessionId}`} className="underline">
            Open it
          </Link>
        </p>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        >
          Record another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Check the transcript</h1>
        <p className="text-sm text-slate-400">
          Fix anything that was misheard, then structure it into sets — or save this exact text as
          a plain note for {localDate}.
        </p>
      </header>

      <label className="block">
        <span className="mb-1 block text-sm text-slate-400">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-slate-400">What you said</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
      </label>

      {save.error && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          {save.error.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={save.isPending || text.trim() === ""}
          onClick={() => onStructure(text)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Structure into sets
        </button>
        <button
          type="button"
          disabled={save.isPending || text.trim() === ""}
          onClick={() => save.mutate({ transcript: text, title, localDate, requestKey })}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save as note"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={save.isPending}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
