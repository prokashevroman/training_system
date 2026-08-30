/**
 * A session title derived from the transcript, because `workout_sessions.title`
 * is NOT NULL and an athlete confirming a voice note should not have to invent
 * one. The first words of what they said usually *are* the summary ("Ran 5k
 * easy then stretched"); the athlete can still edit it before saving.
 */

const MAX_TITLE_CHARS = 60;
const FALLBACK_TITLE = "Voice session";

export function voiceSessionTitle(transcript: string): string {
  // First sentence-ish fragment, whitespace collapsed.
  const flattened = transcript.replace(/\s+/g, " ").trim();
  if (flattened === "") return FALLBACK_TITLE;

  const sentence = flattened.split(/(?<=[.!?])\s/, 1)[0] ?? flattened;
  const base = sentence.replace(/[.!?]+$/, "").trim();
  if (base === "") return FALLBACK_TITLE;
  if (base.length <= MAX_TITLE_CHARS) return base;

  // Cut at a word boundary and mark the cut, so a truncated title never looks
  // like the whole thought.
  const cut = base.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
