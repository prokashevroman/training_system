import type { z, ZodIssue, ZodTypeAny } from "zod";
import { AiHttpError } from "./http-error.js";

/**
 * Validate model output, retry at most once, never guess (brief 7.2 steps 7-8).
 *
 * The retry is not a blind re-roll: the validation issues are fed back as a
 * repair hint, which is the only reason a second attempt is likely to help. If it
 * still fails, the request ends in `schema_invalid`. Returning a partially valid
 * draft is not an option — a half-parsed session that looks plausible is how
 * fabricated training data gets saved.
 */

/** Raised by a provider when output could not even be read as JSON. Repairable. */
export class RepairableModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairableModelError";
  }
}

export interface ModelAttemptContext {
  /** 1 on the first call, 2 on the single permitted repair. */
  readonly attempt: number;
  /** Null on the first call; the validation failure to fix on the second. */
  readonly repairHint: string | null;
}

export interface SchemaRetryResult<T> {
  readonly value: T;
  readonly attempts: number;
}

export interface SchemaRetryContext {
  /** Ties the diagnostic log lines to a request. */
  readonly requestId?: string;
}

/**
 * One line per failed attempt, in log.ts's shape. Without this, a draft that
 * only succeeds via the repair pass looks identical to a clean one from the
 * outside, and a 422 gives no way to see what the model actually got wrong —
 * both bit this project in production. Issues are field paths plus
 * expected/received summaries; the transcript itself never appears in them.
 */
function logAttemptIssues(requestId: string | undefined, attempt: number, issues: string[]): void {
  console.log(
    JSON.stringify({
      level: "info",
      event: "model_schema_issues",
      requestId: requestId ?? null,
      attempt,
      issues: issues.join(" | "),
    }),
  );
}

const MAX_ISSUES_REPORTED = 8;

export function describeIssues(issues: readonly ZodIssue[]): string[] {
  return issues.slice(0, MAX_ISSUES_REPORTED).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

export async function withSchemaRetry<S extends ZodTypeAny>(
  schema: S,
  run: (context: ModelAttemptContext) => Promise<unknown>,
  retryContext: SchemaRetryContext = {},
): Promise<SchemaRetryResult<z.output<S>>> {
  let repairHint: string | null = null;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await run({ attempt, repairHint });
    } catch (error) {
      if (!(error instanceof RepairableModelError)) throw error;
      lastIssues = [error.message];
      logAttemptIssues(retryContext.requestId, attempt, lastIssues);
      repairHint = error.message;
      continue;
    }

    const parsed = schema.safeParse(raw);
    if (parsed.success) return { value: parsed.data, attempts: attempt };

    lastIssues = describeIssues(parsed.error.issues);
    logAttemptIssues(retryContext.requestId, attempt, lastIssues);
    repairHint = [
      "The previous response failed schema validation with these problems:",
      ...lastIssues.map((issue) => `- ${issue}`),
      'Return corrected JSON only. Do not invent values to satisfy the schema: where a field allows null use null and add a warning; where an enum offers "unknown" use that instead.',
    ].join("\n");
  }

  throw new AiHttpError(
    "schema_invalid",
    "The model could not produce a valid draft after one repair attempt.",
    { issues: lastIssues, attempts: 2 },
  );
}
