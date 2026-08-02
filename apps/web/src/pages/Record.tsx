import { useState } from "react";
import { ManualEntryForm } from "../components/record/ManualEntryForm.js";
import { VoiceRecorder } from "../components/record/VoiceRecorder.js";
import { DraftReview } from "../components/record/DraftReview.js";

/**
 * Record: the brief's one-tap capture screen.
 *
 * The microphone is the primary control by design, so it keeps its size and
 * position whether or not the AI worker is configured. When
 * `VITE_AI_WORKER_URL` is unset it renders disabled with a reason rather than
 * pretending to listen — the app has to stay fully usable without AI.
 *
 * A returned draft is never saved automatically. It is shown with its
 * warnings and unconsumed fragments, and only an explicit Save writes.
 */
export function Record() {
  const [mode, setMode] = useState<"capture" | "manual">("capture");
  const [draft, setDraft] = useState<unknown>(null);

  if (draft !== null) {
    return <DraftReview draft={draft} onDiscard={() => setDraft(null)} />;
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
      <VoiceRecorder onDraft={setDraft} onManual={() => setMode("manual")} />
    </div>
  );
}
