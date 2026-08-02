import { useState } from "react";
import {
  draftFromAudio,
  draftFromText,
  isVoiceConfigured,
  queuePendingDraft,
  WorkerError,
} from "../../lib/ai-worker.js";
import { todayLocalDate } from "../../lib/queries.js";
import { formatTimer, useRecorder, MAX_RECORDING_SECONDS } from "../../lib/voice.js";

/**
 * The record button and its states (brief 7.1).
 *
 * Nothing here auto-saves. The Worker returns a draft, the draft is shown with
 * its warnings, and only an explicit Save writes anything — the brief is
 * explicit that AI output must not be saved by default.
 */

interface Props {
  /** Called with the Worker's draft response once parsing succeeds. */
  onDraft: (draft: unknown) => void;
  onManual: () => void;
}

export function VoiceRecorder({ onDraft, onManual }: Props) {
  const recorder = useRecorder();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const configured = isVoiceConfigured();

  const context = () => ({
    timezone: "Europe/Amsterdam",
    localDate: todayLocalDate(),
    idempotencyKey: crypto.randomUUID(),
  });

  async function send(fn: () => Promise<unknown>, fallbackText: string) {
    setSending(true);
    setSendError(null);
    try {
      onDraft(await fn());
      recorder.reset();
    } catch (error) {
      if (error instanceof WorkerError) {
        setSendError(
          `${error.message}${error.requestId ? ` (request ${error.requestId})` : ""}`,
        );
      } else {
        // Almost always a dropped connection. Keep the text so nothing is lost.
        if (fallbackText) {
          queuePendingDraft({
            text: fallbackText,
            localDate: todayLocalDate(),
            queuedAt: new Date().toISOString(),
          });
        }
        setSendError(
          "Could not reach the AI worker. Your text has been queued locally; you can also enter the session manually.",
        );
      }
    } finally {
      setSending(false);
    }
  }

  if (!configured) {
    return (
      <Disabled
        onManual={onManual}
        message="Voice entry needs VITE_AI_WORKER_URL. Until the Cloudflare Worker is deployed it stays switched off rather than recording something nothing can read back."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 py-4">
        {recorder.state === "recording" ? (
          <>
            <button
              type="button"
              onClick={recorder.stop}
              className="grid h-40 w-40 place-items-center rounded-full bg-rose-600 text-white shadow-lg shadow-rose-900/40"
            >
              <span className="text-3xl font-semibold tabular-nums">
                {formatTimer(recorder.seconds)}
              </span>
              <span className="text-xs uppercase tracking-wide">Tap to stop</span>
            </button>
            <button type="button" onClick={recorder.cancel} className="text-sm text-slate-400 underline">
              Cancel
            </button>
            <p className="text-xs text-slate-500">
              Stops automatically at {formatTimer(MAX_RECORDING_SECONDS)}
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={recorder.start}
            disabled={sending || recorder.state === "stopping"}
            className="grid h-40 w-40 place-items-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-900/40 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-16 w-16 fill-current" aria-hidden="true">
              <path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12z" />
            </svg>
            <span className="sr-only">Start recording</span>
          </button>
        )}

        {recorder.error && (
          <p role="alert" className="max-w-xs rounded-lg bg-rose-950/60 px-3 py-2 text-center text-sm text-rose-300">
            {recorder.error.message}
          </p>
        )}

        {recorder.state === "ready" && recorder.recording && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-slate-400">
              Recorded {formatTimer(recorder.recording.durationSeconds)}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => send(() => draftFromAudio(recorder.recording!, context()), "")}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {sending ? "Transcribing…" : "Interpret"}
              </button>
              <button
                type="button"
                onClick={recorder.reset}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300"
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      {sendError && (
        <p role="alert" className="rounded-lg bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
          {sendError}
        </p>
      )}

      <details className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <summary className="cursor-pointer text-sm text-slate-300">Type it instead</summary>
        <p className="mt-2 text-xs text-slate-500">
          The same parser, without the microphone. Useful when speaking is awkward.
        </p>
        <textarea
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          rows={4}
          placeholder="Back squat 4x4 at 90 kg, then bike to and from work"
          className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          type="button"
          disabled={sending || typed.trim().length === 0}
          onClick={() => send(() => draftFromText(typed.trim(), context()), typed.trim())}
          className="mt-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Interpreting…" : "Interpret text"}
        </button>
      </details>

      <div className="text-center">
        <button type="button" onClick={onManual} className="text-sm text-slate-400 underline">
          Enter manually instead
        </button>
      </div>
    </div>
  );
}

function Disabled({ message, onManual }: { message: string; onManual: () => void }) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-4 py-6">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="grid h-40 w-40 cursor-not-allowed place-items-center rounded-full border border-slate-800 bg-slate-900 text-slate-600"
        >
          <svg viewBox="0 0 24 24" className="h-16 w-16 fill-current" aria-hidden="true">
            <path d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12z" />
          </svg>
          <span className="sr-only">Voice entry (unavailable)</span>
        </button>
        <p className="max-w-xs text-center text-sm text-slate-400">{message}</p>
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={onManual}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}
