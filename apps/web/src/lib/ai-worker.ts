import { supabase } from "./supabase.js";

/**
 * Client for the Cloudflare Worker.
 *
 * The Worker turns audio into a transcript and chaotic text into parser
 * notation — text out in both cases, never structured training data. It never
 * writes to Supabase: the browser parses and shows the text, the athlete
 * confirms it, and the save goes through the normal RLS-protected API.
 *
 * `VITE_AI_WORKER_URL` is optional. When it is unset the app is fully usable
 * without voice or AI tidying: manual entry, paste, history, editing and export
 * all keep working, and the record screen says so rather than failing at the
 * point of use.
 */

export const AI_WORKER_URL: string | null = import.meta.env.VITE_AI_WORKER_URL?.trim() || null;

export function isWorkerConfigured(): boolean {
  return AI_WORKER_URL !== null;
}

/** Voice availability is worker availability; the alias keeps call sites honest. */
export function isVoiceConfigured(): boolean {
  return isWorkerConfigured();
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
    const parsed = (await response.json()) as { error?: WorkerErrorBody };
    body = parsed.error ?? (parsed as WorkerErrorBody);
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

/** `POST /v1/transcriptions`: audio in, plain text out. */
export async function transcribe(recording: {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}): Promise<string> {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      mimeType: recording.mimeType,
      durationSeconds: recording.durationSeconds,
    }),
  );
  form.append("audio", recording.blob, "recording");

  const response = await fetch(`${requireUrl()}/v1/transcriptions`, {
    method: "POST",
    // No content-type: the browser must set the multipart boundary itself.
    headers: { authorization: await authHeader() },
    body: form,
  });
  const body = (await unwrap(response)) as { transcript?: unknown };
  if (typeof body.transcript !== "string" || body.transcript.trim() === "") {
    throw new WorkerError(
      { code: "upstream_error", message: "The Worker returned no transcript." },
      200,
    );
  }
  return body.transcript;
}

export interface NormalizedEntry {
  /** Rewrite of the text in parser line notation. Text, never a draft. */
  notation: string;
  /** `YYYY-MM-DD` when the text states when the work happened, else null. */
  localDate: string | null;
}

/**
 * `POST /v1/normalizations`: chaotic text in, parser notation out.
 *
 * The response is only ever *parsed*, never saved: the deterministic parser
 * turns it into a draft in the preview, where warnings and unconsumed lines
 * stay visible, and `raw_text` keeps the athlete's original words regardless.
 */
export async function normalizeEntry(
  text: string,
  todayLocalDate: string,
): Promise<NormalizedEntry> {
  const response = await fetch(`${requireUrl()}/v1/normalizations`, {
    method: "POST",
    headers: { authorization: await authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ text, todayLocalDate }),
  });
  const body = (await unwrap(response)) as { notation?: unknown; localDate?: unknown };
  if (typeof body.notation !== "string" || body.notation.trim() === "") {
    throw new WorkerError(
      { code: "upstream_error", message: "The Worker returned no rewrite." },
      200,
    );
  }
  return {
    notation: body.notation,
    localDate:
      typeof body.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.localDate)
        ? body.localDate
        : null,
  };
}
