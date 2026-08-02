import type { WorkerConfig } from "./env.js";

/**
 * Structured logging with the sensitive fields designed out (brief section 12).
 *
 * There is no way to pass a header map, a token, an audio buffer or transcript
 * text through this module: the accepted field type excludes objects, and text
 * volume is reported as a character count via {@link textSize}. Anything that
 * must be logged about a transcript is therefore a number.
 */
export type LogValue = string | number | boolean | null;

export interface LogFields {
  readonly [key: string]: LogValue | undefined;
}

/** Fields that must never be logged, whatever a future caller passes. */
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "token",
  "accesstoken",
  "bearer",
  "audio",
  "audiobase64",
  "transcript",
  "text",
  "rawtext",
  "notes",
  "jwt",
  "secret",
  "apikey",
]);

export interface Logger {
  info(event: string, fields?: LogFields): void;
  debug(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Reports the size of sensitive text instead of its content. */
export function textSize(text: string | null | undefined): number {
  return text?.length ?? 0;
}

function emit(
  level: "info" | "debug" | "error",
  event: string,
  requestId: string,
  fields: LogFields,
): void {
  const line: Record<string, LogValue> = { level, event, requestId };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      line[key] = "[redacted]";
      continue;
    }
    line[key] = value;
  }
  const serialised = JSON.stringify(line);
  if (level === "error") console.error(serialised);
  else console.log(serialised);
}

export function createLogger(requestId: string, config: WorkerConfig): Logger {
  return {
    info: (event, fields = {}) => emit("info", event, requestId, fields),
    debug: (event, fields = {}) => {
      if (config.logLevel === "debug") emit("debug", event, requestId, fields);
    },
    error: (event, fields = {}) => emit("error", event, requestId, fields),
  };
}
