import { useState } from "react";
import { ManualEntryForm } from "../components/record/ManualEntryForm.js";

/**
 * Record: the brief's one-tap capture screen.
 *
 * The microphone is the primary control by design, so it keeps its size and
 * position — but it is genuinely disabled until the AI worker that transcribes
 * and parses speech exists. A recording button that only pretended to listen
 * would be worse than an honest one that says what it is waiting for.
 */
export function Record() {
  const [manual, setManual] = useState(false);

  if (manual) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Log a session</h1>
          <p className="text-sm text-slate-400">
            Every field is optional except the date and title. Blank stays blank — nothing is
            guessed for you.
          </p>
        </header>
        <ManualEntryForm onCancel={() => setManual(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Record</h1>
        <p className="text-sm text-slate-400">Capture a session you have just finished.</p>
      </header>

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
        <p className="max-w-xs text-center text-sm text-slate-400">
          Voice entry arrives with the AI worker. Until then it stays switched off rather than
          recording something nothing can read back.
        </p>
      </div>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setManual(true)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}
