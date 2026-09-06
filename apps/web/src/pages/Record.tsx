import { useState } from "react";
import { ManualEntryForm } from "../components/record/ManualEntryForm.js";
import { PasteEntryForm } from "../components/record/PasteEntryForm.js";
import { VoiceRecorder } from "../components/record/VoiceRecorder.js";

/**
 * Record: the brief's one-tap capture screen.
 *
 * The microphone is the primary control by design, so it keeps its size and
 * position whether or not the AI worker is configured. When
 * `VITE_AI_WORKER_URL` is unset it renders disabled with a reason rather than
 * pretending to listen — the app has to stay fully usable without voice.
 *
 * Every kind of text — spoken, typed, pasted — lands on the same structuring
 * screen: the deterministic parser reads it, an automatic AI rewrite steps in
 * only for what the parser could not read, and one Save writes the whole
 * session tree. There is no confirm screen in between and nothing the parse
 * produces is refused; "save as a plain note" stays available on that screen
 * as the escape hatch. The manual field-by-field form remains for whoever
 * wants it, but no flow requires it.
 */
export function Record() {
  const [mode, setMode] = useState<"capture" | "manual" | "paste">("capture");
  /** Text handed over for structuring, with its provenance. */
  const [structuring, setStructuring] = useState<{
    text: string;
    origin: "voice" | "manual";
  } | null>(null);

  if (structuring !== null) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Check and save</h1>
          <p className="text-sm text-slate-400">
            This is how your session was read. Fix anything that looks wrong, then save — your
            exact words are stored with it regardless.
          </p>
        </header>
        <PasteEntryForm
          origin={structuring.origin}
          initialText={structuring.text}
          onCancel={() => setStructuring(null)}
        />
      </div>
    );
  }

  if (mode === "paste") {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Paste a session</h1>
          <p className="text-sm text-slate-400">
            Write it the way you write it in the spreadsheet — or however it comes out. The parser
            maps it onto exercises, sets, intervals and loads, and shows you what it read.
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
        <p className="text-sm text-slate-400">
          Speak it or type it — it comes back as a structured session to save.
        </p>
      </header>
      <VoiceRecorder
        onTranscript={(text, origin) => setStructuring({ text, origin })}
        onManual={() => setMode("manual")}
        onPaste={() => setMode("paste")}
      />
    </div>
  );
}
