import { AiHttpError } from "./http-error.js";

/**
 * Best-effort per-user rate limit (brief section 12).
 *
 * State is per isolate, so the real ceiling is `limit * isolates`. That is an
 * accepted trade: the purpose here is to stop one client looping a model call,
 * not to enforce a billing quota. A global limit needs Durable Objects or KV and
 * belongs in the same change that adds usage accounting.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

/** Test seam, and a guard against unbounded growth in a long-lived isolate. */
export function resetRateLimits(): void {
  windows.clear();
}

function sweep(now: number): void {
  if (windows.size < 1000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export function enforceRateLimit(userId: string, limitPerMinute: number, now = Date.now()): void {
  sweep(now);
  const existing = windows.get(userId);
  if (existing === undefined || existing.resetAt <= now) {
    windows.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.count += 1;
  if (existing.count > limitPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    throw new AiHttpError("rate_limited", "Too many requests. Try again shortly.", {
      retryAfterSeconds,
      limitPerMinute,
    });
  }
}
