import type { z, ZodIssue, ZodTypeAny } from "zod";
import { AiHttpError } from "./http-error.js";

/**
 * Shared request validation.
 *
 * Issue paths are safe to return to the client — they describe the request
 * shape, never its content.
 */

const MAX_ISSUES_REPORTED = 8;

export function describeIssues(issues: readonly ZodIssue[]): string[] {
  return issues.slice(0, MAX_ISSUES_REPORTED).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Validates against a shared contract schema.
 *
 * Generic over the SCHEMA rather than over its output type. Writing
 * `ZodType<T>` expands to `ZodType<T, ZodTypeDef, T>`, which forces Zod's
 * Output and Input positions to unify — so for any schema using `.default()`
 * the inferred `T` collapses to the *input* type and every defaulted field
 * silently becomes optional. `z.output<S>` keeps the post-parse type, where
 * defaults have been applied and the fields are present.
 */
export function validate<S extends ZodTypeAny>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AiHttpError("schema_invalid", `${what} failed validation.`, {
      issues: describeIssues(parsed.error.issues),
    });
  }
  return parsed.data;
}
