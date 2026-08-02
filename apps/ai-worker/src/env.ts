import { AI_LIMITS } from "@training/ai-contracts";

/**
 * The Workers AI binding, described by the one method this Worker uses.
 *
 * Typed locally rather than imported from `@cloudflare/workers-types` so tests
 * can supply a two-line fake, and so the surface the Cloudflare providers depend
 * on stays visible and tiny.
 */
export interface AiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/**
 * Everything the Worker reads from its environment.
 *
 * Note what is absent: no Supabase service-role key, no database URL. The Worker
 * cannot write to Supabase even if a bug tried to (brief 7.2 step 9).
 */
export interface WorkerEnv {
  readonly AI?: AiBinding;
  readonly AI_PROVIDER?: string;
  readonly STT_MODEL?: string;
  readonly WORKOUT_PARSER_MODEL?: string;
  readonly PLANNER_MODEL?: string;
  readonly ALLOWED_ORIGINS?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_JWKS_URL?: string;
  readonly SUPABASE_JWT_ISSUER?: string;
  /** Secret. Symmetric HS256 fallback only. */
  readonly SUPABASE_JWT_SECRET?: string;
  readonly MAX_JSON_BODY_BYTES?: string;
  readonly MAX_AUDIO_BYTES?: string;
  readonly MAX_AUDIO_SECONDS?: string;
  readonly MAX_TEXT_CHARS?: string;
  readonly RATE_LIMIT_PER_MINUTE?: string;
  readonly LOG_LEVEL?: string;
}

export type ProviderName = "cloudflare" | "mock";

export interface WorkerConfig {
  /** `mock` unless explicitly set, so tests and previews never call out. */
  readonly provider: ProviderName;
  /**
   * Configured model IDs. Null when unset: the Cloudflare providers then refuse
   * to run rather than falling back to a hard-coded ID, because a silently
   * wrong model is worse than a clear configuration error (brief 7.4).
   */
  readonly models: {
    readonly stt: string | null;
    readonly workoutParser: string | null;
    readonly planner: string | null;
  };
  readonly allowedOrigins: readonly string[];
  readonly supabaseUrl: string | null;
  readonly jwksUrl: string | null;
  readonly expectedIssuer: string | null;
  readonly jwtSecretConfigured: boolean;
  readonly limits: {
    readonly maxJsonBodyBytes: number;
    readonly maxAudioBytes: number;
    readonly maxAudioSeconds: number;
    readonly maxTextChars: number;
  };
  readonly rateLimitPerMinute: number;
  readonly logLevel: "debug" | "info";
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function trimmedOrNull(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value === undefined || value === "" ? null : value;
}

/** Splits the allowlist and drops a trailing slash so `https://x/` matches `https://x`. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

export function resolveConfig(env: WorkerEnv): WorkerConfig {
  const supabaseUrl = trimmedOrNull(env.SUPABASE_URL)?.replace(/\/+$/, "") ?? null;
  const providerRaw = trimmedOrNull(env.AI_PROVIDER);
  const provider: ProviderName = providerRaw === "cloudflare" ? "cloudflare" : "mock";

  return {
    provider,
    models: {
      stt: trimmedOrNull(env.STT_MODEL),
      workoutParser: trimmedOrNull(env.WORKOUT_PARSER_MODEL),
      planner: trimmedOrNull(env.PLANNER_MODEL),
    },
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    supabaseUrl,
    jwksUrl:
      trimmedOrNull(env.SUPABASE_JWKS_URL) ??
      (supabaseUrl === null ? null : `${supabaseUrl}/auth/v1/.well-known/jwks.json`),
    expectedIssuer:
      trimmedOrNull(env.SUPABASE_JWT_ISSUER) ??
      (supabaseUrl === null ? null : `${supabaseUrl}/auth/v1`),
    jwtSecretConfigured: trimmedOrNull(env.SUPABASE_JWT_SECRET) !== null,
    limits: {
      maxJsonBodyBytes: positiveInt(env.MAX_JSON_BODY_BYTES, AI_LIMITS.maxJsonBodyBytes),
      maxAudioBytes: positiveInt(env.MAX_AUDIO_BYTES, AI_LIMITS.maxAudioBytes),
      maxAudioSeconds: positiveInt(env.MAX_AUDIO_SECONDS, AI_LIMITS.maxAudioDurationSeconds),
      maxTextChars: positiveInt(env.MAX_TEXT_CHARS, AI_LIMITS.maxTextChars),
    },
    rateLimitPerMinute: positiveInt(env.RATE_LIMIT_PER_MINUTE, 30),
    logLevel: trimmedOrNull(env.LOG_LEVEL) === "debug" ? "debug" : "info",
  };
}
