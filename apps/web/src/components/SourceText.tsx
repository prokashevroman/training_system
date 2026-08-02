import { parseImportLocator } from "./session-format.js";

/**
 * The verbatim source of a session, always available and never edited.
 *
 * Everything else on the page is an interpretation of this text, so it stays
 * one click away: when a parsed set looks wrong, this is the evidence. For an
 * imported session the workbook coordinate is shown too, because "R17C3" is
 * what makes the claim checkable against the original file.
 */
export function SourceText({
  rawText,
  clientRequestKey,
  transcript,
}: {
  rawText: string;
  clientRequestKey: string | null;
  transcript?: string | null;
}) {
  const locator = parseImportLocator(clientRequestKey);

  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Source text</summary>
      <div className="space-y-3 border-t border-slate-800 p-4">
        {locator && (
          <p className="text-xs text-slate-400">
            Imported from cell{" "}
            <span className="font-medium text-slate-200 tabular-nums">{locator.cell}</span> of sheet
            “{locator.sheet}”{locator.ordinal > 1 && `, session ${locator.ordinal} of that cell`}.
          </p>
        )}
        {!locator && clientRequestKey && (
          <p className="text-xs text-slate-400">
            Idempotency key <span className="text-slate-200">{clientRequestKey}</span>
          </p>
        )}

        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-300">
          {rawText || "(empty)"}
        </pre>

        {transcript && transcript !== rawText && (
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Voice transcript</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-300">
              {transcript}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
