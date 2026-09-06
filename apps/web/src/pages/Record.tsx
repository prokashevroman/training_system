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
 * Every text path leads to the same structured-entry screen: a transcript can
 * be structured into sessions and sets (or saved as a plain note), and pasted
 * text goes through the identical parser preview. The parser is deterministic;
 * the one optional model call rewrites chaotic wording into notation, and its
 * output is re-parsed and shown before anything is saved.
 */
export function Record() {
  const [mode, setMode] = useState<"capture" | "manual" | "paste">("capture");
  const [transcript, setTranscript] = useState<string | null>(null);
  /** A transcript handed over for structuring; renders the paste flow as voice. */
  const [structuring, setStructuring] = useState<string | null>(null);

  if (structuring !== null) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Structure the session</h1>
          <p className="text-sm text-slate-400">
            The parser reads your transcript into exercises, sets and loads — and tells you
            anything it could not read rather than guessing. The transcript itself is stored with
            the session either way.
          </p>
        </header>
        <PasteEntryForm
          origin="voice"
          initialText={structuring}
          onCancel={() => setStructuring(null)}
        />
      </div>
    );
  }

  if (transcript !== null) {
    return (
      <TranscriptConfirm
        transcript={transcript}
        onStructure={(text) => {
          setStructuring(text);
          setTranscript(null);
        }}
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
            Write it the way you write it in the spreadsheet — or however it comes out. The same
            parser that imported the workbook maps it onto exercises, sets and loads, and tells
            you anything it could not read rather than guessing.
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
