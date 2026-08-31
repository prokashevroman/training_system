import { useState } from "react";
import { ManualEntryForm } from "../components/record/ManualEntryForm.js";
import { PasteEntryForm } from "../components/record/PasteEntryForm.js";
import { TranscriptConfirm } from "../components/record/TranscriptConfirm.js";
import { VoiceRecorder } from "../components/record/VoiceRecorder.js";

/**
 * Record: the brief's one-tap capture screen.
 *
 * The microphone is the primary control by design, so it keeps its size and
 * position whether or not the AI worker is configured. When
 * `VITE_AI_WORKER_URL` is unset it renders disabled with a reason rather than
 * pretending to listen — the app has to stay fully usable without voice.
 *
 * Voice is transcript-only: the recording becomes text, the text is shown for
 * one confirming tap, and that exact text is what lands in the database. No
 * model ever guesses structure out of it.
 */
export function Record() {
  const [mode, setMode] = useState<"capture" | "manual" | "paste">("capture");
  const [transcript, setTranscript] = useState<string | null>(null);

  if (transcript !== null) {
    return (
      <TranscriptConfirm
        transcript={transcript}
        onDone={() => setTranscript(null)}
        onDiscard={() => setTranscript(null)}
      />
    );
  }

  if (mode === "paste") {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Paste a session</h1>
          <p className="text-sm text-slate-400">
            Write it the way you write it in the spreadsheet. The same parser that imported the
            workbook maps it onto exercises, sets and loads — and tells you anything it could not
            read rather than guessing.
          </p>
        </header>
        <PasteEntryForm onCancel={() => setMode("capture")} />
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Log a session</h1>
          <p className="text-sm text-slate-400">
            Every field is optional except the date and title. Blank stays blank — nothing is
            guessed for you.
          </p>
        </header>
        <ManualEntryForm onCancel={() => setMode("capture")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Record</h1>
        <p className="text-sm text-slate-400">Capture a session you have just finished.</p>
      </header>
      <VoiceRecorder
        onTranscript={setTranscript}
        onManual={() => setMode("manual")}
        onPaste={() => setMode("paste")}
      />
    </div>
  );
}
