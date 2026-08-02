import { z } from "zod";

/** `YYYY-MM-DD` in the athlete's local timezone. */
export const LocalDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD local date");

/**
 * An IANA timezone name. Only the shape is checked here; the Worker confirms the
 * runtime actually knows the zone before resolving a date with it.
 */
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9+_\-/]*$/, "must be an IANA timezone name");

/**
 * Client-generated idempotency key. The Worker turns it into the session
 * `clientRequestKey`, so a retried upload cannot create a duplicate session.
 */
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "must be a URL-safe idempotency key");

/** One canonical-alias hint the client already has cached locally. */
export const ExerciseAliasHintSchema = z.object({
  alias: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
});
export type ExerciseAliasHint = z.infer<typeof ExerciseAliasHintSchema>;
