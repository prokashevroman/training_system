import { useState } from "react";
import { isVoiceConfigured, transcribe, WorkerError } from "../../lib/ai-worker.js";
import { formatTimer, useRecorder, MAX_RECORDING_SECONDS } from "../../lib/voice.js";

/**
 * The record button and its states (brief 7.1).
 *
 * Stopping a recording sends it straight to transcription — there is no
 * "Interpret" step any more because there is no interpreter. The transcript
 * comes back as plain text and the confirm screen (not this component) is
 * where it gets saved. Typed text skips the network entirely: with no parser
 * in the pipeline, typing IS the transcript.
 */

interface Props {
  /** Called with the transcript (or typed text) to review and save. */
  onTranscript: (text: string) => void;
  onManual: () => void;
}

export function VoiceRecorder({ onTranscript, onManual }: Props) {
  const recorder = useRecorder();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const configured = isVoiceConfigured();

  async function sendRecording() {
    if (!recorder.recording) return;
    setSending(true);
    setSendError(null);
    try {
      const text = await transcribe(recorder.recording);
      recorder.reset();
      onTranscript(text);
    } catch (error) {
      if (error instanceof WorkerError) {
        setSendError(`${error.message}${error.requestId ? ` (request ${error.requestId})` : ""}`);
      } else {
        // Almost always a dropped connection. The recording is still in memory,
        // so the retry button stays available rather than losing the take.
        setSendError("Could not reach the transcription service. Check the connection and retry.");
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
            <button
              type="button"
              onClick={recorder.cancel}
              className="text-sm text-slate-400 underline"
            >
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
          <p
            role="alert"
            className="max-w-xs rounded-lg bg-rose-950/60 px-3 py-2 text-center text-sm text-rose-300"
          >
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
                onClick={() => void sendRecording()}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {sending ? "Transcribing…" : "Transcribe"}
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
          Goes straight to the same confirm screen — no network, no waiting.
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
          disabled={typed.trim().length === 0}
          onClick={() => {
            onTranscript(typed.trim());
            setTyped("");
          }}
          className="mt-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Use this text
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
