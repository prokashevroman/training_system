# Coding-agent request: build a voice-first personal training log and adaptive planning application

You are building a new personal training application from an attached Excel workbook. Treat this as a production-quality personal application, not a quick spreadsheet wrapper or an LLM demo.

## 1. Product objective

Build a mobile-first, installable web application that lets me:

1. Record completed training from desktop or phone.
2. Open the app on my phone, tap a large microphone button, describe what I did, review the interpreted result, and save it in a few actions.
3. Store training as structured data rather than one text cell per day.
4. Have zero, one, or many workout sessions on the same date.
5. Store multiple activities inside one session where they are genuinely part of the same workout.
6. Review, search, filter, edit, and analyze training history.
7. Maintain upcoming training plans separately from completed training.
8. Create annual events and challenges such as Murph, a half marathon, a marathon, a Hyrox-style event, or a CrossFit-style competition.
9. Generate an annual roadmap, event-specific blocks, and editable plans for the next days and weeks.
10. Use inexpensive open-weight models through Cloudflare Workers AI initially, while keeping the AI provider replaceable later by Modal, another hosted provider, or a local model.

The core architectural rule is:

> The database stores facts. Deterministic code enforces planning rules. The LLM interprets, proposes, and explains. The LLM is not the sole source of training logic and must never write unvalidated data directly into the database.

## 2. My context and constraints

- I have prior experience with Supabase and am comfortable creating a project and connecting it to an application.
- I have no practical experience with Cloudflare Workers or Workers AI.
- Therefore, a separate beginner-friendly Cloudflare setup and deployment guide is a mandatory deliverable.
- My timezone is `Europe/Amsterdam`.
- I may speak English, Russian, or a mixture of both in voice entries.
- Historical notes also contain occasional Spanish labels such as `cadencia`, `fc promedio`, `Frec. cardiaca`, and `lpm`.
- Cost minimization matters. Do not use OpenAI or Anthropic as the default provider.
- Do not require an always-on GPU.
- The first AI implementation should use Cloudflare Workers AI with hosted open-weight models.
- Model identifiers must be configuration, not hard-coded business logic, because Cloudflare model availability and deprecation status can change.
- The application should remain useful even when AI is temporarily unavailable: manual entry, history, editing, deterministic planning, and existing approved plans must still work.

## 3. Required technology direction

Use this stack unless there is a concrete technical reason to change it:

- Monorepo: `pnpm` workspaces.
- Frontend: React, TypeScript, Vite.
- Mobile delivery: installable PWA, responsive layout, phone home-screen support.
- UI: Tailwind CSS and a restrained component library such as shadcn/ui.
- Client data: TanStack Query.
- Form validation: React Hook Form plus shared Zod schemas.
- Database and authentication: Supabase Postgres and Supabase Auth.
- Authorization: Row Level Security on every user-owned table.
- AI gateway: a separate Cloudflare Worker written in TypeScript.
- Spreadsheet extraction: Python with `openpyxl` for the one-time and repeatable Excel import pipeline.
- Testing: Vitest for unit tests and Playwright for critical browser flows.
- Database changes: versioned SQL migrations in `supabase/migrations`.

Preferred repository structure:

```text
training-app/
├── apps/
│   ├── web/
│   └── ai-worker/
├── packages/
│   ├── domain/
│   ├── ai-contracts/
│   ├── planner/
│   └── analytics/
├── scripts/
│   └── import-workbook/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── tests/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── EXCEL_IMPORT.md
│   ├── PLANNING_ENGINE.md
│   └── CLOUDFLARE_WORKERS_AI_SETUP.md
├── .env.example
└── README.md
```

Final naming may vary, but do not collapse the web app, Worker, planner, and migration logic into one unstructured project.

## 4. Non-negotiable data-model principles

1. A calendar date is not a workout record.
2. One date can have many workout sessions.
3. One session can have many activities.
4. A session and an activity are different concepts.
5. Strength sets, cardio intervals, circuits, and benchmark splits require their own structured records.
6. Planned work and completed work must remain separate.
7. Raw source text and transcripts must always be preserved.
8. Missing values must remain `null`; never invent distance, duration, repetitions, weight, heart rate, or other facts.
9. Store timestamps in UTC and store/derive an explicit `local_date` using the user profile timezone.
10. Canonical values should be normalized, while original units and wording remain traceable.
11. Use UUID primary keys, foreign keys, useful indexes, timestamps, and sensible cascade behavior.
12. Every user-owned table must contain or inherit a trustworthy path to `user_id` and have tested RLS policies.

## 5. Required domain model

You may refine field names, but preserve the following entities and relationships.

### 5.1 Athlete and configuration

#### `profiles`

At minimum:

- `user_id`
- `timezone`, default `Europe/Amsterdam`
- `preferred_units`
- `default_language`
- optional age/height fields
- preferred weekly session range
- weekday and weekend duration limits
- training preferences
- current constraints
- injury or pain notes
- created/updated timestamps

#### `weekly_training_requirements`

Editable baseline requirements rather than hard-coded assumptions. Examples:

- strength exposure
- easy aerobic work
- quality endurance work
- long endurance work
- hybrid conditioning
- mobility/recovery
- skill work

Fields should support minimum sessions, maximum sessions, priority, target minutes, target hard sets, and whether the requirement is mandatory or optional.

#### `availability_rules`

Support:

- available weekdays
- fixed unavailable days
- preferred hard-training days
- maximum duration by day
- travel periods
- location/equipment availability by day
- regular bike-commute days

#### `equipment_profiles` and `equipment_items`

Examples: main gym, home, hotel, outdoors. Represent available equipment, weight ranges, counts, and notes.

### 5.2 Completed training

#### `workout_sessions`

One logically coherent completed session. Required fields include:

- `id`
- `user_id`
- `local_date`
- optional `started_at`
- `title`
- `source`: manual, voice, Excel import, integration
- `raw_text`
- `transcript`
- `notes`
- optional duration
- optional session RPE
- status: draft, completed, discarded
- optional `planned_session_id`
- idempotency/client request key
- created/updated timestamps

#### `activities`

A session can contain one or many activities. Required concepts:

- `session_id`
- sequence/order
- modality
- subtype
- training objective
- optional duration
- optional distance
- optional calories
- average/max heart rate
- cadence
- elevation gain
- average power
- intensity classification
- `details JSONB` for unusual modality-specific facts
- notes

Use a controlled modality set similar to:

- strength
- running
- cycling
- rowing
- ski erg
- swimming
- hybrid conditioning
- mobility/recovery
- walking/hiking
- surfing or other sport/outdoor activity
- dance
- other

Use a controlled objective set similar to:

- max strength
- hypertrophy
- power
- skill
- aerobic base
- tempo/threshold
- VO2 max
- race-specific
- hybrid conditioning
- recovery
- commute

#### `exercises`

Canonical exercise library with:

- canonical name and slug
- movement pattern
- primary and secondary muscle groups
- equipment
- unilateral flag
- bodyweight flag
- active flag

Movement patterns should include squat, hinge, horizontal push, horizontal pull, vertical push, vertical pull, unilateral leg, carry, core, locomotion, power, and mobility.

#### `exercise_aliases`

Map free text and transcription variants to canonical exercises. Support English, Russian, abbreviations, common misspellings, and historical wording. Examples include:

- hex bar deadlift / trap bar deadlift / deadlift with Hex bar
- RDL / Romanian deadlift
- DB / dumbbell
- climbers bar
- DL
- MU

#### `strength_sets`

One row per set. Support:

- activity and exercise
- set index
- set type: warm-up, working, drop, AMRAP, test
- repetitions
- load value and original unit
- normalized kilograms where conversion is valid
- load scope: total, per hand, per side, added bodyweight, machine setting, unknown
- side when unilateral
- RIR
- RPE
- tempo
- rest seconds
- completed flag
- notes

Do not lose distinctions such as “20 kg in each hand,” “2 x 24 kg dumbbells,” “5 kg added to a pull-up,” or a machine setting that is not truly kilograms.

#### `cardio_intervals`

One row per interval or split, supporting:

- interval index/type
- work duration
- rest duration
- distance
- pace
- speed
- heart rate
- power
- cadence
- notes

This must support Norwegian 4x4-style sessions, rowing splits, running repetitions, and similar interval work.

#### `circuit_results` and `circuit_movements`

Support AMRAP, EMOM, for-time, rounds, interval circuits, and custom formats. Include:

- rounds completed
- partial-round repetitions
- time cap
- completion time
- score
- prescribed/scaled flag
- ordered movements with target repetitions, calories, distance, time, and load
- flexible details JSON for unusual scoring

#### `benchmark_definitions`, `benchmark_results`, and `benchmark_splits`

First-class benchmark support for:

- Murph
- half Murph
- Cindy
- 1,000 m row
- 5 km, 10 km, half-marathon, and marathon running
- future Hyrox simulation
- user-defined tests

For Murph, support vest weight, partition strategy, run splits, pull-up/push-up/squat split times, total time, and movement-quality notes.

#### `daily_checkins`

Optional quick readiness data:

- sleep duration and quality
- fatigue
- soreness by body area
- stress
- motivation
- pain
- resting heart rate/HRV if supplied
- illness flag
- free-text note

#### `body_measurements`

Support date, body weight, waist, optional body-fat estimate, and notes.

#### `tags` and join tables

Tags are useful for travel, hotel, outdoor, Murph, half-marathon, Hyrox, deload, test, and recovery. Do not use tags instead of structured modality/objective fields.

### 5.3 Plans and events

#### `event_templates`

Reusable templates for Murph, half marathon, marathon, Hyrox, CrossFit-style competition, and custom events. Store recommended phase types, phase-duration ranges, required training qualities, event-specific metrics, taper logic, and maintenance requirements for non-priority qualities.

#### `events`

Each actual event occurrence is its own row. Include:

- name and event type
- priority A/B/C
- target date or target date window
- optional target distance/time/pace
- status
- notes

A yearly Murph challenge must create a new yearly event instance so year-over-year results remain comparable.

#### `training_blocks`

Represent base, build, specific, taper, recovery, and custom phases with dates, objectives, weekly targets, and constraints.

#### `plan_versions`

Every generated or manually changed plan is versioned. Include:

- period start/end
- planning horizon
- source: manual, deterministic, LLM-assisted
- provider/model/prompt version when AI was used
- assumptions
- generation reason
- status: draft, approved, superseded
- timestamps

Never silently overwrite an approved plan.

#### `planned_sessions`, `planned_activities`, and planned prescriptions

Keep future work separate from completed work. Support:

- scheduled date
- objective
- priority
- estimated duration/load
- fixed or movable
- rationale
- status: planned, completed, skipped, moved, replaced
- prescribed exercises, sets, rep ranges, RIR/RPE, intervals, circuits, and alternatives
- link to the completed session when performed

### 5.4 Ingestion and AI audit

#### `import_batches`

Include file name, checksum, sheet name, importer version, parser version, start/end timestamps, counts, status, and error summary.

#### `import_entries`

One row per non-empty source day cell, including:

- batch ID
- sheet
- source row/column/cell reference
- week label
- inferred local date
- raw text
- raw-text checksum
- deterministic extraction result
- AI draft
- validation result
- warnings/uncertainties
- review status
- links to created sessions

Add a unique constraint that makes imports idempotent.

#### `ai_runs`

Record provider, model, operation, prompt version, request ID, status, latency, token/usage metadata when available, estimated cost when available, schema-validation outcome, and error category. Do not store secrets, access tokens, or raw audio here.

#### `user_corrections`

Store the original draft, approved result, and changed fields so future parser evaluation can use real corrections.

## 6. Initial task: convert the attached Excel workbook into this model

This is an initial product milestone, not a later enhancement.

### 6.1 Known workbook structure

The currently attached workbook has:

- one worksheet named `Training programm 2026`
- 54 rows and 8 columns
- row 1 containing a week-label column plus seven day columns
- columns B through H representing Day 1 through Day 7, even though the final header is currently named `Column 8`
- rows 2 through 54 representing calendar weeks
- 31 weeks currently containing training data
- 170 non-empty day cells
- empty future weeks that must not create empty workout records

The week labels are free text such as:

- `Week 01 Dec 29, 2025 Jan 4`
- `Week 31 July 27 Aug 2`
- `Week 53 Dec 28 Jan 3, 2027`

Treat Day 1 as Monday and Day 7 as Sunday. Derive the date from the parsed week start plus the column offset. Handle year boundaries correctly and test them explicitly.

### 6.2 Nature of the historical data

A single cell may contain:

- a strength workout plus a bike commute
- swimming plus running
- a Murph sequence containing run, calisthenics, and another run
- a circuit with rowing, deadlifts, push-ups, squats, sled work, or ski erg
- mobility, massage, walking, or hiking
- several unrelated sessions separated by blank lines
- notes about technique, sickness, fatigue, equipment, or movement quality

The importer must split independent sessions but keep genuinely composite workouts together.

Examples of required behavior:

- `Bike to & from work` plus a gym strength workout becomes two sessions on the same date.
- A Murph entry remains one benchmark session with multiple activities and benchmark splits.
- A circuit remains one hybrid session with ordered circuit movements.
- Swimming followed by an unrelated run becomes two sessions.
- A massage or rolling entry becomes recovery/mobility, not strength.

### 6.3 Parsing requirements

Handle at least:

- decimal comma: `97,5` means 97.5
- kilograms and pounds
- weight per hand versus total load
- weighted bodyweight movements
- bodyweight-only movements
- machine settings that should not be falsely labeled as kilograms
- `5x5`, `4x4`, `3x10`, `4 sets x3`, and mixed set-load notation
- notation such as `Back squat 5x5: 1x80, 3x85, 1x90`
- notation such as `4x4 (1x70 kg, 3x72.5 kg)`
- unilateral notation such as `3 sets x15 each leg`
- running distance, pace, speed, cadence, average heart rate, zone, vest weight, and elevation
- rowing distance/time/pace
- interval pace lists
- round counts, time caps, and completion times
- Murph/Cindy details and splits
- common spelling errors such as `Deadlifw`, `preperation`, or `lasst`
- Spanish metrics and mixed-language notes

Preserve original text and original units. Convert to normalized units only when conversion is unambiguous. If a treadmill speed lacks an explicit unit, preserve it and add an ambiguity warning instead of guessing.

### 6.4 Import workflow

Create a repeatable import pipeline with these stages:

1. `inspect`: profile the workbook and produce a Markdown/JSON report.
2. `extract`: create one staging entry for every non-empty day cell.
3. `preparse`: deterministic normalization for dates, decimal commas, known units, and obvious aliases.
4. `AI parse`: send the raw entry plus strict domain schema and alias context to the Worker text-parsing endpoint.
5. `validate`: validate with shared Zod/JSON Schema and domain rules.
6. `review`: expose warnings and low-confidence records in an import-review UI.
7. `apply`: transactionally create sessions, activities, sets, intervals, circuits, and benchmarks.
8. `reconcile`: generate a report proving that every source cell is accounted for.

Required command behavior:

- dry-run mode
- local Supabase mode by default
- explicit remote mode
- batch size control
- resumable operation
- idempotency
- no duplicate records when rerun
- no committed secret keys
- structured logs and a final report

Use a trusted local environment for remote import credentials. The Cloudflare Worker must not need a Supabase service-role key for normal voice usage.

### 6.5 Import quality gates

At minimum, the final migration report must show:

- 170 source day cells discovered
- 170 staging/import entries created
- counts of parsed, warning, review-required, approved, and failed entries
- counts of created sessions and activities
- unresolved exercise aliases
- unresolved units or numbers
- examples of multi-session splits
- proof that blank future weeks created no sessions
- a checksum or source locator linking every database record to its original cell

Do not import derived workbook analysis as truth. Recalculate analytics from structured records.

## 7. Voice-entry architecture

The primary mobile flow should be:

1. Open the installed PWA directly to Today or Record.
2. Tap a large Record button.
3. Speak naturally.
4. Tap Stop.
5. See a structured draft with uncertainties.
6. Make a quick correction if needed.
7. Tap Save.

Do not auto-save AI output by default.

### 7.1 Browser capture

Use `MediaRecorder` with capability detection. Requirements:

- work on current desktop Chrome and mobile Safari/Chrome where browser support permits
- HTTPS in production
- visible timer
- cancel action
- maximum app-level recording duration, initially five minutes
- size limit
- clear microphone-permission error
- retain a text-entry fallback
- queue an unsent draft locally if the network disappears before upload

Do not permanently store audio by default. Delete/discard it after successful transcription and parsing. A temporary debug-retention setting may exist but must be opt-in.

### 7.2 Cloudflare Worker API

Create a separate Worker with at least:

- `GET /health`
- `POST /v1/workout-drafts/from-audio`
- `POST /v1/workout-drafts/from-text`
- `POST /v1/plans/draft`
- optional `POST /v1/plans/explain`

All endpoints except health require a valid Supabase bearer token.

The Worker should:

1. Validate origin and CORS against an allowlist.
2. Validate the Supabase access token and obtain the user ID.
3. Enforce payload, duration, and context limits.
4. Transcribe audio with a configurable Cloudflare speech model.
5. Parse the transcript with a configurable open-weight chat model.
6. Request structured output where supported.
7. Validate the result against shared schema.
8. Retry at most once for a repairable schema failure.
9. Return a draft plus warnings; do not write approved workout records.
10. Return consistent error objects with a request ID.

The browser saves the user-approved draft to Supabase through normal RLS-protected APIs. This keeps the AI Worker out of the final data-approval path and avoids exposing a service-role key.

### 7.3 Supabase authentication in the Worker

Implement a server-side Supabase client with no persistent session. Validate the bearer token using the current supported Supabase JWT-claims mechanism, with a compatible fallback for projects still using symmetric signing keys. Reject missing, expired, malformed, or invalid tokens.

Do not trust a user ID sent in the request body. Derive it from the verified token.

### 7.4 Cloudflare AI binding

Use a Workers AI binding in `wrangler.jsonc`, exposed to code as `env.AI`. Keep model choices in non-secret environment variables, for example:

- `STT_MODEL`
- `WORKOUT_PARSER_MODEL`
- `PLANNER_MODEL`

Initial preference:

- speech: a current non-deprecated Cloudflare-hosted Whisper model, preferably `@cf/openai/whisper-large-v3-turbo` if still available and appropriate
- parser/planner: prefer `@cf/qwen/qwen3-30b-a3b-fp8` if it still supports the required structured-output behavior; otherwise select a current non-deprecated open-weight Workers AI model that supports JSON Mode or reliable schema-constrained output

At implementation time, verify current Cloudflare model status and capabilities. Add a live smoke test so a deprecated or incompatible configured model fails clearly.

### 7.5 Parsing contract

The parser must receive:

- transcript/raw text
- current local date and timezone
- preferred units
- canonical exercise aliases
- recent exercise names
- allowed enum values
- strict output schema

Its system rules must include:

- never invent missing data
- use `null` for unknown values
- preserve ambiguities and warnings
- split independent sessions
- keep composite workouts together
- normalize only when confident
- return all source fragments or mark unconsumed text
- never give medical diagnosis

The response should include:

- resolved local date
- one or more session drafts
- activities and detailed metrics
- uncertainties
- warnings
- unconsumed text fragments
- parser metadata

## 8. Mandatory Cloudflare setup README

Create `docs/CLOUDFLARE_WORKERS_AI_SETUP.md` specifically for a developer who knows Supabase but has never used Cloudflare.

It must be copy/paste-friendly and explain both the mental model and every command. Include:

1. What Cloudflare Workers and Workers AI are in this architecture.
2. The exact request flow from PWA to Worker to AI and back to Supabase.
3. How to create/sign in to a Cloudflare account.
4. Required local prerequisites and supported Node version.
5. How to install dependencies.
6. How to authenticate Wrangler with `npx wrangler login`.
7. The relevant `wrangler.jsonc` structure.
8. How the Workers AI binding works and why code uses `env.AI`.
9. All required environment variables and which are secrets.
10. A committed `.dev.vars.example`, but never a committed `.dev.vars` containing real values.
11. How to set production secrets with `npx wrangler secret put <NAME>`.
12. How to run locally with `npx wrangler dev` or the project wrapper script.
13. A warning that local Workers AI inference still calls Cloudflare and can consume usage.
14. How to run unit tests without live AI calls.
15. How to run an explicit live AI smoke test.
16. How to deploy with `npx wrangler deploy`.
17. How to obtain the deployed `workers.dev` URL.
18. How to set the frontend `VITE_AI_WORKER_URL`.
19. How to configure allowed frontend origins for local and production environments.
20. How to test health, authentication, text parsing, audio transcription, and plan generation.
21. How to inspect Worker logs and Workers AI usage.
22. How to avoid surprise costs: application limits, request quotas, short prompts, compact context, and dashboard monitoring.
23. Troubleshooting for CORS errors, 401 errors, microphone/audio-format failures, schema failures, model deprecation, and missing bindings.
24. How to create staging and production Worker environments.
25. Optional CI deployment instructions using a scoped Cloudflare API token, without requiring CI for local development.
26. How to completely remove the Worker and secrets if needed.

The guide must contain no unexplained placeholders such as “configure Cloudflare normally.” Explain where each value comes from.

## 9. AI provider abstraction

Do not couple domain code directly to Cloudflare. Create interfaces similar in purpose to:

```ts
interface SpeechToTextProvider {
  transcribe(input: AudioInput): Promise<TranscriptResult>;
}

interface WorkoutParserProvider {
  parseWorkout(input: ParseWorkoutInput): Promise<WorkoutDraft>;
}

interface TrainingPlannerProvider {
  generatePlan(input: GeneratePlanInput): Promise<PlanDraft>;
  explainAdjustment(input: ExplainAdjustmentInput): Promise<PlanExplanation>;
}
```

Provide Cloudflare implementations now. Leave clean seams for later Modal and local/Ollama implementations. The web UI and planning engine must not know Cloudflare model IDs.

## 10. Planning-engine design

Implement four planning horizons:

1. Annual roadmap: broad base/build/specific/taper/recovery periods.
2. Mesocycle: four to eight weeks of objectives and progression.
3. Approved weekly plan: seven to fourteen operational days.
4. Daily adaptation: what to do today and how to react to missed work/readiness.

### 10.1 Deterministic layer

Build a deterministic requirements engine first. It should combine:

- editable baseline weekly requirements
- current event requirements
- event priority
- current phase
- availability
- equipment
- recent training exposure
- completed versus missed sessions
- readiness/pain/illness constraints

It must be able to create a valid week without an LLM.

Do not hard-code one fixed training week. Provide sensible seeded defaults based on the imported history, but expose them for review and editing.

### 10.2 Event overlay

Event templates should change the weekly mix.

Examples:

- Half marathon: more run frequency, easy volume, long run, threshold/interval work, strength maintenance, taper.
- Murph: running before/after fatigue, pull-up/push-up/squat capacity, vest exposure, partition strategy, rehearsals, taper.
- Hyrox: running under fatigue, station-specific work, carries/sled/row/ski/lunges/wall balls, transitions, strength maintenance.

The event layer defines required qualities and boundaries, not arbitrary exact loads for every athlete.

### 10.3 LLM layer

The LLM may:

- explain a deterministic plan
- choose among valid alternatives
- propose a human-readable weekly arrangement
- identify likely imbalances
- suggest a valid session substitution
- explain why a session was moved, shortened, or dropped

The LLM may not:

- invent completed history
- alter event dates without explicit user action
- override pain or illness rules
- silently remove mandatory weekly components
- make database writes
- publish a plan without validation and user approval

### 10.4 Plan validator

Validate every plan for:

- weekly session limits
- mandatory qualities
- availability
- equipment compatibility
- hard-day spacing
- event-phase requirements
- recovery requirements
- duration constraints
- duplicate/conflicting sessions
- progression limits
- pain/injury exclusions
- valid exercises and units

Prefer deterministic repair for simple violations instead of repeatedly calling the model.

### 10.5 Compact AI context

Do not send the complete database to the model. Build SQL views or server-side summaries for:

- last 7, 28, and 84 days
- modality mix
- hard sets by movement pattern
- strength progression
- running volume/intensity and pace/heart-rate trends
- plan adherence
- active event and weeks remaining
- current phase
- recent readiness and missed sessions

No vector database is required for the MVP.

## 11. Required application UI

Use mobile bottom navigation with approximately:

- Today
- Record
- Plan
- History
- More

Desktop may use a sidebar.

### Today

Show today’s planned session, completed sessions, quick readiness check, next session, active event, weeks remaining, and one concise recommendation.

### Record

Initial state: one large microphone button plus a smaller manual-text/manual-entry option.

After parsing, show:

- transcript
- detected sessions
- activities
- exercises/sets/intervals
- tags
- missing values and uncertainties
- Edit, Save, and Discard

### History

Support list, calendar, and desktop table views. Filters should include:

- date
- modality
- objective
- exercise
- movement pattern
- intensity
- event
- planned/unplanned
- location/equipment profile
- source
- benchmark

### Plan

Show the next seven to fourteen days. Support approve, edit, move, skip, replace, and regenerate one session without regenerating the entire plan.

### Events

Show date/window, priority, phase, weeks remaining, preparation metrics, and next milestone.

### Analytics

Start with transparent metrics:

- active days and sessions per week
- modality mix
- planned versus completed
- hard sets by movement pattern
- strength trends
- running distance/pace/heart rate/cadence
- easy versus hard endurance
- bike commute load
- benchmark history
- event-specific progress

Do not create a mysterious single readiness score without showing its components.

### Settings

Include weekly requirements, availability, equipment profiles, units, language, audio retention, AI provider/model display, export, and data deletion.

## 12. Security and privacy

- Enable and test RLS on all user-owned tables.
- Use `auth.uid()`-based ownership policies.
- Never expose a Supabase service/secret key in the browser or Worker.
- Never commit `.env`, `.dev.vars`, tokens, or credentials.
- Verify Worker bearer tokens server-side.
- Restrict CORS to configured origins.
- Do not log bearer tokens or raw audio.
- Avoid logging full transcripts and sensitive health notes in production.
- Add app-level rate limits and payload limits.
- Use idempotency keys for voice saves and imports.
- Provide account-data export and deletion paths.

For statements indicating acute pain, chest pain, dizziness, fever, illness, unusual shortness of breath, or injury, deterministic safety rules must prevent a normal hard-session recommendation. The application may recommend rest or professional assessment but must not diagnose medical conditions.

## 13. Testing and evaluation

### 13.1 Database/RLS tests

Test that one user cannot select, insert, update, or delete another user’s data. Test parent-child ownership paths and cascade behavior.

### 13.2 Import tests

Create fixtures from representative workbook cells and test:

- Monday-to-Sunday date mapping
- 2025/2026 and 2026/2027 year boundaries
- multi-session splitting
- Murph preservation as a composite benchmark
- Norwegian interval extraction
- mixed set/load notation
- pounds-to-kilograms normalization with original units retained
- per-hand load
- decimal commas
- Spanish metrics
- unknown/ambiguous treadmill speed
- idempotent rerun

### 13.3 Voice/parser tests

Maintain a permanent evaluation set of text and audio examples covering English, Russian, mixed language, noisy speech, corrections, multiple sessions, and missing values.

Measure:

- schema validity
- date correctness
- exercise identification
- set/repetition/load correctness
- cardio-metric correctness
- invented-data rate
- unconsumed source text
- manual correction rate
- latency and estimated cost

### 13.4 Planner tests

Create scenarios such as:

- eight weeks before a half marathon
- two weeks before Murph
- event date moved
- missed lower-body session
- travel with dumbbells only
- high soreness
- illness flag
- frequent bike commuting
- deload week
- two competing events

Test rule compliance before judging prose quality.

### 13.5 End-to-end tests

At minimum:

- sign in
- create manual session
- record/submit a voice draft through a mocked Worker
- edit and save draft
- filter history
- create event
- generate deterministic week
- approve/move/skip a session
- link completed session to planned session

## 14. Documentation deliverables

Create and keep current:

- `README.md`: complete local setup from fresh clone
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md` with ER diagram
- `docs/EXCEL_IMPORT.md`
- `docs/PLANNING_ENGINE.md`
- `docs/CLOUDFLARE_WORKERS_AI_SETUP.md`
- `.env.example`
- `.dev.vars.example` for the Worker
- API request/response examples
- migration report for the current workbook

The main README must contain a “first successful local run” path with exact commands for Supabase, web app, Worker, migrations, seed data, and workbook dry run.

## 15. Implementation order

Work incrementally in this order. Do not start with a polished dashboard while the data model and import are unresolved.

### Phase 0: repository and architecture

- Create monorepo and shared contracts.
- Write initial architecture/data-model docs.
- Add environment examples and scripts.
- Profile the workbook and commit the generated non-sensitive profile report.

### Phase 1: Supabase schema and security

- Implement migrations, enums/reference tables, indexes, timestamps, and RLS.
- Seed canonical exercises, aliases, event templates, and basic workout templates.
- Add database/RLS tests.

### Phase 2: workbook migration

- Build inspect/extract/preparse/validate/apply pipeline.
- Create staging/import tables and review statuses.
- Parse all 170 non-empty cells into staging.
- Build a minimal import-review interface.
- Produce reconciliation report.

### Phase 3: core PWA without AI dependency

- Authentication.
- Today, manual Record, History, filters, details/editing.
- PWA manifest/installability.
- Basic export.

### Phase 4: Cloudflare Worker and voice

- Worker project, binding, auth, CORS, endpoints, mocks, logs.
- Cloudflare README.
- Audio capture, transcription, structured parse, review, save.
- Live smoke tests separated from normal unit tests.

### Phase 5: events and deterministic planning

- Event creation/templates.
- Annual roadmap and blocks.
- Editable weekly requirements.
- Deterministic weekly plan generation and validation.
- Plan versioning and planned/completed linking.

### Phase 6: LLM-assisted planning

- Compact athlete-state summaries.
- Plan explanation and alternatives.
- AI plan draft, validation, review, approval.
- AI-run audit and correction capture.

### Phase 7: analytics and hardening

- Transparent dashboards.
- Import cleanup.
- Performance/accessibility.
- Backup/export/delete flows.
- Provider benchmark harness for future Modal/local model comparison.

## 16. Definition of done for the first meaningful release

The release is not complete until all of the following are true:

1. I can install the PWA on my phone.
2. I can sign in and only access my own data.
3. The current workbook has been extracted into 170 traceable staging records.
4. Approved historical records are represented as sessions, activities, sets, intervals, circuits, and benchmark results rather than one cell per day.
5. A date can display several independent sessions.
6. I can manually add and edit a session.
7. I can record a short voice note, receive a structured draft, correct it, and save it.
8. The original transcript/raw text remains available.
9. Cloudflare setup can be completed by following the dedicated README without prior Cloudflare experience.
10. The app works without AI for existing data and manual entry.
11. I can create an event and see its phase/remaining weeks.
12. The deterministic engine can produce a valid editable week.
13. The LLM can explain or propose adjustments, but invalid plans cannot be approved.
14. RLS, parser, import, planner, and critical E2E tests pass.
15. No secrets are committed.

## 17. How to work on this request

- First inspect the repository and attached workbook.
- Summarize the implementation plan and any assumptions you are making.
- Then begin implementing in the stated order rather than returning only a conceptual proposal.
- Do not ask me to make routine technical choices already resolved in this brief.
- Do not block on Cloudflare or Supabase credentials: create code, mocks, `.env` examples, and exact setup documentation. Real deployment can be performed when I authenticate locally.
- When a detail is genuinely ambiguous, choose the safest reversible implementation and document the assumption.
- Keep changes migration-based, tested, and easy to review.
- At the end of each phase, report files created, commands run, tests passed, remaining warnings, and the next phase.
