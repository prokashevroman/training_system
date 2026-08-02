import { supabase } from "./supabase.js";

/**
 * Client for the Cloudflare Worker (Phase 4).
 *
 * The Worker only ever returns a DRAFT. Nothing here writes to Supabase — the
 * user reviews the draft and the browser saves it through the normal
 * RLS-protected API, which keeps the Worker out of the data-approval path and
 * means it never needs a service-role key.
 *
 * `VITE_AI_WORKER_URL` is optional. When it is unset the app is fully usable
 * without AI: manual entry, history, editing and export all keep working, and
 * the record screen says so rather than failing at the point of use.
 */

export const AI_WORKER_URL: string | null = import.meta.env.VITE_AI_WORKER_URL?.trim() || null;

export function isVoiceConfigured(): boolean {
  return AI_WORKER_URL !== null;
}

export interface WorkerErrorBody {
  code: string;
  message: string;
  requestId?: string;
}

export class WorkerError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  constructor(body: WorkerErrorBody, status: number) {
    super(body.message || `Worker returned ${status}`);
    this.name = "WorkerError";
    this.code = body.code || "upstream_error";
    this.requestId = body.requestId ?? null;
  }
}

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return `Bearer ${token}`;
}

async function unwrap(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  let body: WorkerErrorBody = { code: "upstream_error", message: response.statusText };
  try {
    body = (await response.json()) as WorkerErrorBody;
  } catch {
    // A non-JSON error body means the failure happened before the Worker's own
    // handler ran — a CORS rejection or an edge error. Keep the status text.
  }
  throw new WorkerError(body, response.status);
}

function requireUrl(): string {
  if (!AI_WORKER_URL) {
    throw new Error("VITE_AI_WORKER_URL is not set, so voice entry is unavailable.");
  }
  return AI_WORKER_URL.replace(/\/$/, "");
}

export async function checkHealth(): Promise<boolean> {
  if (!AI_WORKER_URL) return false;
  try {
    const response = await fetch(`${requireUrl()}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export interface DraftRequestContext {
  timezone: string;
  localDate: string;
  idempotencyKey: string;
}

export async function draftFromText(
  text: string,
  context: DraftRequestContext,
): Promise<unknown> {
  const response = await fetch(`${requireUrl()}/v1/workout-drafts/from-text`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await authHeader() },
    body: JSON.stringify({ text, ...context }),
  });
  return unwrap(response);
}

export async function draftFromAudio(
  recording: { blob: Blob; mimeType: string; durationSeconds: number },
  context: DraftRequestContext,
): Promise<unknown> {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      mimeType: recording.mimeType,
      durationSeconds: recording.durationSeconds,
      ...context,
    }),
  );
  form.append("audio", recording.blob, "recording");

  const response = await fetch(`${requireUrl()}/v1/workout-drafts/from-audio`, {
    method: "POST",
    // No content-type: the browser must set the multipart boundary itself.
    headers: { authorization: await authHeader() },
    body: form,
  });
  return unwrap(response);
}

/**
 * A draft that could not be sent, kept until the network returns.
 *
 * The brief requires an unsent draft to survive a dropped connection. Audio is
 * deliberately NOT queued — it must not be persisted — so only the transcript
 * or typed text is held, which is the part worth keeping anyway.
 */
const QUEUE_KEY = "training:pending-drafts";

export interface PendingDraft {
  text: string;
  localDate: string;
  queuedAt: string;
}

export function queuePendingDraft(draft: PendingDraft): void {
  const existing = readPendingDrafts();
  localStorage.setItem(QUEUE_KEY, JSON.stringify([...existing, draft]));
}

export function readPendingDrafts(): PendingDraft[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingDraft[]) : [];
  } catch {
    return [];
  }
}

export function clearPendingDrafts(): void {
  localStorage.removeItem(QUEUE_KEY);
}
