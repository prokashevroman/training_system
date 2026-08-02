import type { PreferredUnits, SessionSource } from "@training/domain";
import type { ModelMetadata, TranscriptionMetadata } from "./metadata.js";
import type { PlanDraft, PlanExplanation } from "./plan-draft.js";
import type { ExerciseAliasHint } from "./primitives.js";
import type { WorkoutDraft } from "./workout-draft.js";

/**
 * Provider seams (brief section 9).
 *
 * Nothing in this file mentions Cloudflare, Workers AI, `env.AI`, a model ID or
 * an HTTP client — that is the entire point. A Modal, Ollama or hosted-API
 * implementation must be droppable behind these three interfaces without any
 * change to the web app or the planning engine. `provider` and `model` appear
 * only as opaque strings inside returned metadata.
 */

/** Raw audio handed to a transcription provider. */
export interface AudioInput {
  /** The recording exactly as captured. Never logged, never persisted. */
  readonly bytes: Uint8Array;
  /** MIME type reported by the recorder, e.g. `audio/webm;codecs=opus`. */
  readonly mimeType: string;
  /** Client-measured duration; null when the recorder reported none. */
  readonly durationSeconds: number | null;
  /** BCP-47 hint, e.g. `en`. Null lets the provider auto-detect. */
  readonly language: string | null;
}

export interface TranscriptResult {
  /** Full transcript text. Returned to the athlete, never written to logs. */
  readonly text: string;
  readonly metadata: TranscriptionMetadata;
}

export interface SpeechToTextProvider {
  transcribe(input: AudioInput): Promise<TranscriptResult>;
}

/**
 * Everything the parser is contractually entitled to receive (brief 7.5).
 * Assembled server-side; the client supplies only hints, never a user id.
 */
export interface ParseWorkoutInput {
  /** Transcript or typed text, verbatim. */
  readonly text: string;
  /** Today in the athlete's timezone, so "yesterday" resolves correctly. */
  readonly nowLocalDate: string;
  readonly timezone: string;
  readonly preferredUnits: PreferredUnits;
  /** How the entry reached the system; copied onto every session draft. */
  readonly source: SessionSource;
  /** Canonical alias hints, possibly empty. */
  readonly exerciseAliases: readonly ExerciseAliasHint[];
  /** Recently used exercise names, to bias resolution towards the athlete's own. */
  readonly recentExerciseNames: readonly string[];
  /** Becomes the session `clientRequestKey`; derived from the idempotency key. */
  readonly clientRequestKey: string;
  /** Correlation id for logs and returned metadata. */
  readonly requestId: string;
}

export interface WorkoutParserProvider {
  parseWorkout(input: ParseWorkoutInput): Promise<WorkoutDraft>;
}

/** A completed session summarised for planner context. Load-light on purpose. */
export interface RecentSessionSummary {
  readonly localDate: string;
  readonly title: string;
  readonly modalities: readonly string[];
  readonly durationSeconds: number | null;
  readonly sessionRpe: number | null;
}

export interface GeneratePlanInput {
  readonly startLocalDate: string;
  readonly timezone: string;
  readonly weeks: number;
  readonly goal: string;
  readonly preferredUnits: PreferredUnits;
  /** Availability, equipment, travel — free text from the athlete. */
  readonly constraints: readonly string[];
  readonly recentSessions: readonly RecentSessionSummary[];
  /** Subjective notes. Scanned deterministically for safety flags. */
  readonly notes: string | null;
  readonly requestId: string;
}

export interface ExplainAdjustmentInput {
  readonly timezone: string;
  /** What the plan said before the adjustment. */
  readonly previousSummary: string;
  /** What it says now. */
  readonly proposedSummary: string;
  /** Observed reasons: missed sessions, high RPE, illness. */
  readonly signals: readonly string[];
  readonly notes: string | null;
  readonly requestId: string;
}

export interface TrainingPlannerProvider {
  generatePlan(input: GeneratePlanInput): Promise<PlanDraft>;
  explainAdjustment(input: ExplainAdjustmentInput): Promise<PlanExplanation>;
}

/** The three seams together, as resolved once per request. */
export interface AiProviderSet {
  readonly name: string;
  readonly speechToText: SpeechToTextProvider;
  readonly workoutParser: WorkoutParserProvider;
  readonly trainingPlanner: TrainingPlannerProvider;
}

/** Narrow helper so implementations build metadata consistently. */
export type MetadataInit = Omit<ModelMetadata, "attempts"> & { attempts?: number };
