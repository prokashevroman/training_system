# Cloudflare Workers AI setup

For a developer who is comfortable with Supabase and has never used Cloudflare.
Every command is meant to be copy/pasted. Every value is traced back to the
system that produces it.

## Read this first: what is verified and what is not

Nobody on this project has a Cloudflare account yet, so **none of the Cloudflare
steps in this guide have been executed**. They are written from Cloudflare's
documented behaviour and from the code in `apps/ai-worker`, which is real and
tested. Concretely:

| Part                                                                                | Status                                                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/ai-worker` code, routes, env contract, error codes, mock provider, test suite | Verified — the suite runs offline and passes                            |
| `wrangler.jsonc` / `.dev.vars.example` variable names                               | Verified — quoted from the committed files                             |
| Account creation, `wrangler login`, `wrangler dev`, `wrangler deploy`, dashboard UI | **Unverified** — never run here; Cloudflare's UI and wording move      |
| The three model IDs                                                                 | **Unverified preferences** from the brief, not checked against the live catalogue |
| Free-allocation and pricing numbers                                                 | **Not quoted** on purpose — read them off Cloudflare's pricing page    |

Before the first deploy, open
<https://developers.cloudflare.com/workers-ai/models/> and confirm that all
three configured IDs still exist, are not deprecated, and have the capabilities
the code needs:

- `@cf/openai/whisper-large-v3-turbo` — speech to text. The code sends
  `{ audio: <base64 string> }`; older Whisper variants take an integer array
  instead, so the payload shape needs confirming too (see
  `apps/ai-worker/src/providers/cloudflare/stt.ts`).
- `@cf/qwen/qwen3-30b-a3b-fp8` — parser and planner. It must still support JSON
  Mode / schema-constrained output. If it does not, pick a current
  non-deprecated open-weight model that does and change the two variables.

Nothing else in the repo needs to change when a model ID changes: model IDs are
configuration and live only in `wrangler.jsonc` (see section 8).

---

## 1. What Workers and Workers AI are in this architecture

Two Cloudflare products are used, and nothing else.

**Workers** is a serverless runtime. You give Cloudflare one JavaScript module
that exports a `fetch(request, env)` function; Cloudflare runs it on their edge
network at a URL. The mental model closest to something you already know is a
single Supabase Edge Function — except the runtime is V8 with Web APIs
(`Request`, `Response`, `fetch`, `crypto`, `FormData`), not Deno, and there is
no built-in database client.

**Workers AI** is Cloudflare's hosted model inference. Instead of an API key and
a base URL, the Worker gets a **binding**: an object injected into `env` at
runtime that you call as `env.AI.run(modelId, input)`. Cloudflare handles
authentication implicitly from the account the Worker is deployed to, which is
why there is no `CLOUDFLARE_API_TOKEN` anywhere in this repo's runtime
configuration.

In this system the Worker has exactly one job: **turn speech or free text into a
structured draft, and propose plan drafts.** It is the interpretation layer.

What the Worker deliberately does *not* do:

- It has **no database access and no Supabase service-role key.** Look at
  `WorkerEnv` in `apps/ai-worker/src/env.ts` — there is no connection string and
  no service key to leak. The browser saves the athlete's approved draft to
  Supabase through normal RLS-protected APIs.
- It **stores nothing.** Audio exists only for the duration of one request and
  is never written or logged.
- It **never decides anything.** It returns drafts, warnings and unconsumed text
  fragments. Deterministic code and the athlete decide.

This follows the governing rule in `docs/ARCHITECTURE.md`: the database stores
facts, deterministic code enforces rules, the LLM interprets and proposes and
never writes unvalidated data.

## 2. The exact request flow

```text
 Browser (PWA, apps/web)
   |  1. MediaRecorder captures audio, or the athlete types text
   |  2. supabase-js already holds a signed-in session -> access token (JWT)
   |
   |  3. POST ${VITE_AI_WORKER_URL}/v1/workout-drafts/from-audio
   |     Authorization: Bearer <supabase access token>
   |     Origin: https://<the PWA origin>
   |     multipart/form-data: audio=<blob>, meta=<json>
   v
 Cloudflare Worker (apps/ai-worker)  --  handleRequest in src/app.ts
   |  4. assign a request id (x-request-id, echoed on every response)
   |  5. check Origin against ALLOWED_ORIGINS            -> 403 forbidden_origin
   |  6. match the route                                  -> 404 not_found
   |  7. verify the bearer token, take userId from `sub`  -> 401 unauthorized
   |  8. per-user rate limit                              -> 429 rate_limited
   |  9. select the provider (cloudflare | mock)
   | 10. enforce byte / duration / character limits       -> 413
   |
   |  11. env.AI.run(STT_MODEL, { audio })  ------------> Workers AI (Cloudflare)
   |      <----------------------------------------------- transcript
   |  12. env.AI.run(WORKOUT_PARSER_MODEL, prompt) -----> Workers AI (Cloudflare)
   |      <----------------------------------------------- JSON draft
   |  13. validate against the shared Zod schema in packages/ai-contracts
   |      one repair retry if the JSON is repairable, else 422 schema_invalid
   |  14. discard the audio
   v
 Browser
   |  15. render the draft: sessions, activities, warnings (each with the
   |      source fragment it came from), unconsumed fragments, and the
   |      transcript so the athlete can see what was heard
   |  16. the athlete edits and taps Save (nothing is auto-saved)
   v
 Supabase Postgres
       17. supabase-js INSERT as the signed-in user, RLS enforces
           user_id = auth.uid(). The Worker is not in this step at all.
```

The Worker sits beside the data path, never inside it. A compromised Worker can
waste inference; it cannot write, read or delete an athlete's records.

## 3. Create or sign in to a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up>.
2. Sign up with an email address and password, then confirm the verification
   email. No domain name and no credit card are required to use `workers.dev`
   subdomains and the Workers AI free allocation.
3. If an account already exists, sign in at <https://dash.cloudflare.com/login>
   instead.
4. Once inside, note two things you will need later:
   - **Account ID** — dashboard sidebar, or the URL
     `https://dash.cloudflare.com/<account-id>/...`. Needed only for CI
     (section 25); local development gets it from the OAuth login.
   - **workers.dev subdomain** — under **Workers & Pages → Subdomain**. You
     choose it once per account. Your Worker's public URL will be
     `https://training-ai-worker.<subdomain>.workers.dev` (section 17).

Enable Workers AI by visiting **AI → Workers AI** in the dashboard once. On a
new account the first `wrangler deploy` of a Worker with an `ai` binding is what
actually activates it; visiting the page first just makes the usage charts
available to look at.

## 4. Local prerequisites and supported Node version

| Tool     | Required version                     | Where the requirement is stated               |
| -------- | ------------------------------------ | --------------------------------------------- |
| Node.js  | `>= 20`                              | `engines.node` in the root `package.json`     |
| pnpm     | `11.5.2`                             | `packageManager` in the root `package.json`   |
| Wrangler | `^4.0.0` (installed as a dev dep)    | `devDependencies` in `apps/ai-worker/package.json` |
| Supabase CLI | `^2.22.6` (installed as a dev dep) | root `devDependencies`; needed for a local token |

Node 20 or newer is the floor. Node 22 is what the repo's `@types/node` targets
and is a safe choice.

```bash
node --version    # must print v20.x or newer
pnpm --version    # must print 11.5.2
```

If `pnpm` is missing or the wrong version, let Node install the pinned one:

```bash
corepack enable
corepack prepare pnpm@11.5.2 --activate
```

Nothing else is needed. You do **not** need Docker for the Worker (only for
`supabase start`), and you do **not** need a globally installed `wrangler` —
`npx wrangler` resolves the version pinned in `apps/ai-worker/package.json`.

## 5. Install dependencies

From the repository root:

```bash
pnpm install
```

This installs the whole workspace, including `wrangler` and `@cloudflare/workers-types`
for `apps/ai-worker`.

One workspace detail matters here. `pnpm-workspace.yaml` contains:

```yaml
allowBuilds:
  esbuild: true
  workerd: true
```

`workerd` is the open-source Cloudflare Workers runtime that `wrangler dev` runs
your code on locally. It downloads a native binary in a postinstall script, and
pnpm blocks postinstall scripts unless they are allowlisted — that entry is the
allowlist. If `wrangler dev` later complains that it cannot find `workerd`,
re-run `pnpm install` from the root rather than installing anything globally.

Verify the Worker package builds and its tests pass before touching Cloudflare
at all:

```bash
pnpm --filter @training/ai-worker typecheck
pnpm --filter @training/ai-worker test
```

Both work offline and with no Cloudflare account.

## 6. Authenticate Wrangler with `npx wrangler login`

Wrangler is Cloudflare's CLI. It is the equivalent of the `supabase` CLI in your
existing workflow.

```bash
cd apps/ai-worker
npx wrangler login
```

This opens a browser window asking you to authorise Wrangler against your
Cloudflare account. Approving it stores an OAuth token in Wrangler's own config
directory in your home folder — **not** in the repository, so there is nothing
to accidentally commit.

Confirm and inspect:

```bash
npx wrangler whoami     # prints the email and account ID(s) you are logged in as
```

If the account has more than one entry, set the one to use for this Worker:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id-from-whoami>
```

To sign out:

```bash
npx wrangler logout
```

All `wrangler` commands in this guide are run from `apps/ai-worker`, because
Wrangler discovers `wrangler.jsonc` in the current directory. From the repo root
you can either use the package script (`pnpm --filter @training/ai-worker dev`)
or pass the config explicitly (`npx wrangler dev -c apps/ai-worker/wrangler.jsonc`).

## 7. The `wrangler.jsonc` structure

This is `apps/ai-worker/wrangler.jsonc` as committed, with comments trimmed. It
is the whole deployment configuration — there is no dashboard-side setup that is
not represented here.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "training-ai-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-06-01",
  "observability": { "enabled": true },

  "ai": { "binding": "AI" },

  "vars": {
    "AI_PROVIDER": "cloudflare",

    "STT_MODEL": "@cf/openai/whisper-large-v3-turbo",
    "WORKOUT_PARSER_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
    "PLANNER_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",

    "ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
    "SUPABASE_URL": "http://127.0.0.1:54321",

    "MAX_JSON_BODY_BYTES": "131072",
    "MAX_AUDIO_BYTES": "10485760",
    "MAX_AUDIO_SECONDS": "300",
    "MAX_TEXT_CHARS": "12000",
    "RATE_LIMIT_PER_MINUTE": "30"
  }
}
```

Field by field:

- **`$schema`** — points at the schema shipped inside the installed `wrangler`
  package, so an editor autocompletes and validates this file.
- **`name`** — the Worker's name in your account, and the first label of its
  `workers.dev` hostname. Changing it creates a *different* Worker; it does not
  rename the existing one.
- **`main`** — the entry module. `src/index.ts` exports `{ fetch }` and nothing
  else; Wrangler bundles the TypeScript itself, so there is no build step.
- **`compatibility_date`** — pins the runtime's behaviour. Cloudflare ships
  breaking runtime changes behind dates, so an old date keeps old semantics.
  Raise it deliberately, not casually. There is no `compatibility_flags`
  entry and no `nodejs_compat`: the Worker uses only Web APIs.
- **`observability.enabled`** — turns on the dashboard's Logs/Metrics views and
  log retention for this Worker (section 21). Without it, `wrangler tail` still
  streams live but the dashboard shows much less.
- **`ai.binding`** — see section 8.
- **`vars`** — non-secret configuration, deployed *with* the Worker and visible
  in the dashboard. Anything sensitive must be a secret instead (section 11).
  Note that all numeric limits are strings: `vars` values arrive as strings and
  `resolveConfig` in `src/env.ts` parses them.

The file has **no `secrets` section**, by design: secrets are never written to
disk in a repo. It also has no `[env.staging]` block yet; section 24 shows how
to add one.

## 8. How the AI binding works, and why the code says `env.AI`

This single line

```jsonc
"ai": { "binding": "AI" }
```

tells Cloudflare: when this Worker runs, inject an AI client into the `env`
object under the property name `AI`. `"binding"` is the *variable name you
choose*; `AI` is conventional and is what the brief specifies. Rename it and
you must rename it in the code too.

There is no API key, no endpoint URL and no SDK import. Authentication is
implicit: the binding is bound to the Cloudflare account that owns the Worker.
That is the point of bindings — credentials are never handled by your code, so
they cannot be logged, committed or exfiltrated.

The code side is deliberately tiny. `apps/ai-worker/src/env.ts` declares only
the one method the Worker uses:

```ts
export interface AiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface WorkerEnv {
  readonly AI?: AiBinding;
  // ...
}
```

Two consequences worth understanding:

- **`AI` is optional (`AI?`).** A unit test passes a two-line fake instead of a
  real binding, and the Worker starts fine without one. If the `cloudflare`
  provider is selected while the binding is absent, `requireBinding` in
  `src/providers/cloudflare/workers-ai.ts` fails loudly with
  `upstream_error: "The Workers AI binding is not configured."` rather than
  pretending to work.
- **`run` returns `unknown`.** Workers AI response shapes differ per model and
  have changed over time, so `workers-ai.ts` validates every response with Zod
  and accepts both the direct (`{ response }`) and REST-wrapped
  (`{ result: { response } }`) shapes.

Only `apps/ai-worker/src/providers/cloudflare/` knows that Cloudflare model IDs
exist. The web app, the domain package and the planner never see one — that is
the provider abstraction required by brief section 9.

## 9. Every environment variable, and which are secrets

Only one variable is ever a secret, and even that one is optional.

| Variable                | Secret? | Where the value comes from                                                                                              |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`           | No      | `cloudflare` or `mock`. Anything other than the exact string `cloudflare` resolves to `mock` (`resolveConfig`, `src/env.ts`). |
| `STT_MODEL`             | No      | A Workers AI model ID from <https://developers.cloudflare.com/workers-ai/models/>.                                      |
| `WORKOUT_PARSER_MODEL`  | No      | Same catalogue; must support JSON Mode / schema-constrained output.                                                     |
| `PLANNER_MODEL`         | No      | Same catalogue. May be the same ID as the parser, and currently is.                                                     |
| `ALLOWED_ORIGINS`       | No      | Comma-separated exact origins. Local: the Vite dev server, `http://localhost:5173`. Production: the deployed PWA origin. |
| `SUPABASE_URL`          | No      | Local: `http://127.0.0.1:54321`, the `API URL` printed by `supabase status`. Hosted: **Project Settings → API → Project URL** in the Supabase dashboard. |
| `SUPABASE_JWKS_URL`     | No      | Optional override. Defaults to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.                                         |
| `SUPABASE_JWT_ISSUER`   | No      | Optional override. Defaults to `${SUPABASE_URL}/auth/v1`, and must equal the `iss` claim in your tokens.                |
| `SUPABASE_JWT_SECRET`   | **Yes** | Only for projects still signing with symmetric HS256, which includes local Supabase. Local value: the `JWT secret` printed by `supabase status`. Hosted: **Project Settings → API → JWT Settings → JWT Secret**. |
| `MAX_JSON_BODY_BYTES`   | No      | Bytes. `131072` (128 KiB), matching `AI_LIMITS.maxJsonBodyBytes` in `packages/ai-contracts`.                            |
| `MAX_AUDIO_BYTES`       | No      | Bytes. `10485760` (10 MiB).                                                                                             |
| `MAX_AUDIO_SECONDS`     | No      | Seconds. `300`, the brief's five-minute recording cap.                                                                  |
| `MAX_TEXT_CHARS`        | No      | Characters of transcript or typed text. `12000`.                                                                        |
| `RATE_LIMIT_PER_MINUTE` | No      | Requests per authenticated user per minute. `30`. Counted per Worker isolate (see section 20.6).                          |
| `LOG_LEVEL`             | No      | `info` (default) or `debug`. `debug` adds request metadata only — never tokens, audio or transcript text.               |

Every one of these except `AI_PROVIDER`'s default is optional in code: unset
limits fall back to the shared defaults in `packages/ai-contracts/src/limits.ts`.
Model IDs are the exception that does **not** fall back — an unset `STT_MODEL`
makes the Cloudflare provider refuse to run, because a silently substituted
model would produce plausible output from the wrong place.

**Variables that do not exist, and must not be added:** any Supabase
service-role key, any database URL, any `CLOUDFLARE_API_TOKEN` (bindings replace
it; CI is the only exception, section 25).

### Where each kind of value is stored

| Kind                        | Local (`wrangler dev`)        | Deployed                                        |
| --------------------------- | ----------------------------- | ----------------------------------------------- |
| Non-secret configuration    | `.dev.vars` (overrides `vars`) | `vars` in `wrangler.jsonc`, committed           |
| Secret                      | `.dev.vars`, gitignored        | `npx wrangler secret put NAME`, never committed |

## 10. `.dev.vars.example` is committed, `.dev.vars` never is

`apps/ai-worker/.dev.vars.example` is committed and contains no real
credentials. It is the checklist of every variable, annotated with whether it is
a secret. Copy it once:

```bash
cd apps/ai-worker
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored and must never be committed. The root `.gitignore`
carries three lines that together allow only the example file:

```gitignore
.dev.vars
.dev.vars.*
!.dev.vars.example
```

Confirm it yourself rather than trusting this document:

```bash
git check-ignore -v apps/ai-worker/.dev.vars   # prints: .gitignore:15:.dev.vars ...
git status --porcelain apps/ai-worker           # .dev.vars must NOT appear here
```

Two notes on the copied file:

- It ships with `AI_PROVIDER=mock`, deliberately. A fresh checkout runs the full
  voice flow end to end with no Cloudflare account and no inference spend. Flip
  it to `cloudflare` only when you intend to make real calls.
- The `SUPABASE_JWT_SECRET` value in the example
  (`super-secret-jwt-token-with-at-least-32-characters-long`) is the publicly
  documented default that local Supabase uses. It is not a credential. Never
  reuse it for a hosted project.

If you ever commit a real secret by accident, treat it as leaked: rotate it in
Supabase, then re-set it with `wrangler secret put`. Removing the commit is not
sufficient.

## 11. Setting production secrets with `npx wrangler secret put`

Secrets are stored encrypted in your Cloudflare account, injected into `env` at
runtime exactly like `vars`, and are **not readable back** — the dashboard and
CLI show only names.

```bash
cd apps/ai-worker

# Prompts for the value on stdin so it never reaches your shell history.
npx wrangler secret put SUPABASE_JWT_SECRET
```

Paste the `JWT Secret` from your hosted Supabase project's **Project Settings →
API → JWT Settings** at the prompt and press Enter.

You only need this if your Supabase project still issues symmetric **HS256**
tokens. Projects on the current asymmetric signing keys (RS256/ES256/EdDSA)
need **no secret at all**: the Worker fetches the project's public JWKS from
`SUPABASE_URL` and verifies against that. Check which you have by decoding a
token's header — see section 20.

Managing secrets:

```bash
npx wrangler secret list                          # names only, never values
npx wrangler secret delete SUPABASE_JWT_SECRET
npx wrangler secret put SUPABASE_JWT_SECRET --env staging   # per-environment
```

Do not put a model ID or `ALLOWED_ORIGINS` in a secret. They are not sensitive,
and keeping them in `vars` means a code review can see what a deploy will
actually do.

## 12. Running locally with `npx wrangler dev`

```bash
cd apps/ai-worker
npx wrangler dev
```

Or, from anywhere in the repo, the package script (`"dev": "wrangler dev"`):

```bash
pnpm --filter @training/ai-worker dev
```

Either way the Worker is served at **<http://localhost:8787>**. Wrangler runs
your code on `workerd`, the same runtime Cloudflare runs in production, and it
reads `.dev.vars` on top of the `vars` in `wrangler.jsonc`.

Useful flags:

```bash
npx wrangler dev --port 8788                   # if 8787 is taken
npx wrangler dev --var AI_PROVIDER:mock        # override one var without editing files
npx wrangler dev --log-level debug             # Wrangler's own verbosity
```

Smoke-check it immediately. `GET /health` needs no token and no `Origin` header:

```bash
curl -s http://localhost:8787/health | jq
```

```json
{
  "status": "ok",
  "service": "ai-worker",
  "provider": "mock",
  "models": {
    "stt": "mock-stt-v1",
    "workoutParser": "mock-parser-v1",
    "planner": "mock-planner-v1"
  },
  "requestId": "…"
}
```

`provider` and `models` echo the resolved configuration, so a wrong model ID or
an accidental `mock` in production is visible in one request without a token.

For the full local loop you want three things running: `supabase start` (for
auth and the database), `wrangler dev` (this Worker) and the Vite dev server in
`apps/web`.

## 13. Warning: local Workers AI inference is real inference

**`wrangler dev` does not run models locally.** There is no local Whisper and no
local Qwen. `workerd` runs your JavaScript on your machine, but every
`env.AI.run(...)` call is proxied over the network to Cloudflare's inference
service, against your real account.

That means, whenever `AI_PROVIDER=cloudflare`:

- local development **consumes your Workers AI allocation** and can bill you;
- it needs network access and `wrangler login`;
- a loop, a hot-reload storm, or an accidental retry costs the same as it would
  in production.

This is why `.dev.vars.example` ships `AI_PROVIDER=mock` and why `mock` is the
default for any unrecognised value. Day-to-day UI work, schema work and test
work should all run on `mock`. Switch to `cloudflare` for a deliberate,
time-boxed session, then switch back.

A one-off real call without editing any file:

```bash
npx wrangler dev --var AI_PROVIDER:cloudflare
```

## 14. Running tests with no live AI calls

The whole point of the `mock` provider. It is deterministic, offline, needs no
Cloudflare account, and makes no network calls at all.

```bash
# The Worker's suite
pnpm --filter @training/ai-worker test

# Everything in the workspace
pnpm test
```

`apps/ai-worker/vitest.config.ts` uses `environment: "node"` and the tests call
`handleRequest(request, env)` directly with a fake `env` object. No `workerd`,
no Wrangler, no network, no account. `resolveConfig` treats any `AI_PROVIDER`
other than the literal `cloudflare` as `mock`, so a test that forgets to set it
still cannot spend money.

To exercise the mock provider through real HTTP instead of unit tests:

```bash
cd apps/ai-worker
npx wrangler dev --var AI_PROVIDER:mock
# /health then reports "provider": "mock"
```

Mock responses are fixed shapes that satisfy the same Zod schemas in
`packages/ai-contracts` as real ones, so the browser cannot tell the difference
structurally. What they do not tell you is whether a *model ID* is valid — only
section 15 does that.

## 15. Running an explicit live AI smoke test

This is the check that catches a deprecated model, a renamed model, or a payload
shape that the current model no longer accepts. It is manual and explicit on
purpose: no automated test in this repo ever calls Cloudflare, so this cannot
happen by accident in CI or on a laptop.

Run it after every model-ID change and before every production deploy.

```bash
cd apps/ai-worker

# 1. Real provider, real account.
npx wrangler dev --var AI_PROVIDER:cloudflare
```

```bash
# 2. Confirm the configuration that will actually be used.
curl -s http://localhost:8787/health | jq '{provider, models}'
```

`provider` must be `cloudflare` and the three IDs must be the ones you intend.
If `/health` itself returns `502 upstream_error`, the binding or a model
variable is missing — see section 23.

```bash
# 3. Cheapest possible real parser call: short text, empty context.
TOKEN="$(<a Supabase access token; see section 20>)"

curl -s -X POST http://localhost:8787/v1/workout-drafts/from-text \
  -H "Origin: http://localhost:5173" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "text": "3x10 back squat 60 kg",
        "timezone": "Europe/Madrid",
        "idempotencyKey": "smoke-parser-001"
      }' | jq '{provider: .metadata.provider, model: .metadata.model, attempts: .metadata.attempts, sessions: (.sessions | length)}'
```

A pass looks like `provider: "cloudflare"`, the configured parser model ID,
`attempts: 1` and one session. `attempts: 2` means the first response failed
schema validation and the repair retry saved it — the model works but is
marginal for structured output. A `502 upstream_error` whose `details.model`
names your model is the deprecation signal.

Then the speech model, which is the more fragile of the two because its input
shape has changed across Whisper generations:

```bash
# 4. A short real recording. Any 2-3 second clip is enough.
#    macOS: record with QuickTime and export, or use an existing .webm/.m4a.
curl -s -X POST http://localhost:8787/v1/workout-drafts/from-audio \
  -H "Origin: http://localhost:5173" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'meta={"timezone":"Europe/Madrid","mimeType":"audio/webm","durationSeconds":3,"idempotencyKey":"smoke-audio-001"}' \
  -F "audio=@/path/to/clip.webm;type=audio/webm" | jq '{transcript, model: .transcription.model}'
```

If the transcript comes back empty or the call returns `upstream_error`, check
the payload shape first: `src/providers/cloudflare/stt.ts` sends
`{ audio: <base64 string> }`, and some Whisper variants want an array of
integers instead. That is a one-line change in `stt.ts`, not a configuration
change.

Keep the whole smoke test to a handful of requests. It is a correctness check,
not a load test.

## 16. Deploying with `npx wrangler deploy`

Before deploying, make sure the committed `vars` are the ones you want in
production — in particular `SUPABASE_URL` and `ALLOWED_ORIGINS`, which are
checked in with **local** values.

```bash
cd apps/ai-worker

pnpm --filter @training/ai-worker typecheck
pnpm --filter @training/ai-worker test

npx wrangler deploy
```

Equivalently, `pnpm --filter @training/ai-worker deploy` (the package's
`"deploy": "wrangler deploy"` script).

Wrangler bundles `src/index.ts`, uploads it, attaches the `ai` binding and the
`vars`, and prints the deployed URL and version ID. First deploy on a fresh
account also creates your `workers.dev` subdomain if you have not chosen one.

Useful variations:

```bash
npx wrangler deploy --dry-run --outdir=/tmp/worker-build   # bundle only, upload nothing
npx wrangler deploy --env staging                          # a separate Worker (section 24)
npx wrangler versions list                                 # what is deployed
npx wrangler rollback                                      # back to the previous version
```

After deploying, verify the deployed configuration the same way as locally:

```bash
curl -s https://training-ai-worker.<subdomain>.workers.dev/health | jq
```

`provider` must be `cloudflare` in production. If it says `mock`, the deployed
`vars` are wrong and the app is silently returning fabricated drafts.

## 17. Getting the `workers.dev` URL

The URL is `https://<worker name>.<your subdomain>.workers.dev`, so with the
committed `name` it is
`https://training-ai-worker.<subdomain>.workers.dev`.

Three ways to find `<subdomain>`:

1. `npx wrangler deploy` prints the full URL in its output.
2. Dashboard → **Workers & Pages** → `training-ai-worker` → the URL is shown on
   the Worker's overview.
3. Dashboard → **Workers & Pages** → **Subdomain** shows the account-level
   subdomain on its own.

`workers.dev` URLs are HTTPS by default, which the PWA needs for microphone
access in production. A custom domain is optional and not needed for this
project.

## 18. Setting the frontend `VITE_AI_WORKER_URL`

`apps/web/.env.example` already has the variable:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Phase 4: the deployed Cloudflare Worker URL. Leave blank to disable voice.
VITE_AI_WORKER_URL=
```

Create your own `apps/web/.env` from it and fill in all three:

```bash
cp apps/web/.env.example apps/web/.env
```

```bash
# apps/web/.env  — local development
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the "anon key" printed by `supabase status`>
VITE_AI_WORKER_URL=http://localhost:8787
```

```bash
# production build
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<Supabase dashboard: Project Settings -> API -> anon public>
VITE_AI_WORKER_URL=https://training-ai-worker.<subdomain>.workers.dev
```

Rules:

- **No trailing slash.** The client appends paths like
  `/v1/workout-drafts/from-text`.
- **Blank disables voice.** That is the intended state before the Worker exists,
  and the manual text-entry fallback keeps working.
- `VITE_`-prefixed variables are **inlined into the browser bundle** by Vite, so
  only public values belong here. That is why the Supabase *anon* key is fine
  and why no service-role key or Cloudflare token ever gets a `VITE_` prefix.
- Vite reads `.env` at dev-server start and at build time. Restart the dev
  server after changing it.

## 19. Configuring allowed frontend origins

`ALLOWED_ORIGINS` is a comma-separated list of **exact** origins
(scheme + host + port). `apps/ai-worker/src/cors.ts` matches exactly: no
wildcards, no `*`, no suffix matching — suffix matching is how
`evil-myapp.com` gets accepted by a rule meant for `myapp.com`. A trailing slash
is tolerated and stripped.

Local development (already the committed default):

```jsonc
"ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173"
```

Both are listed because `localhost` and `127.0.0.1` are different origins to a
browser, and Vite may print either.

Production — replace with the deployed PWA origin(s):

```jsonc
"ALLOWED_ORIGINS": "https://training.example.com"
```

Add a preview origin only if you actually deploy previews, and prefer the
staging Worker (section 24) over widening the production allowlist.

Two behaviours to know before you debug a CORS error:

- A `/v1` request with **no** `Origin` header is rejected with
  `403 forbidden_origin`. The browser PWA always sends one, so a missing header
  means something else is calling — including a cross-site form post. This is
  why every `curl` example below passes `-H "Origin: http://localhost:5173"`.
- `GET /health` is exempt, so uptime checks and bare `curl` work.

The response sets `access-control-allow-credentials: false` and never uses
cookies: the access token travels in the `Authorization` header, so the Worker
does not need credentialed CORS.

## 20. Testing health, auth, text parsing, audio and plan generation

### 20.0 Get a bearer token

All `/v1` endpoints need a real Supabase access token. Do not hand-craft one —
the Worker verifies the signature, the issuer, the expiry and the audience.

With local Supabase running (`supabase start`) and a test user that exists in
`auth.users`:

```bash
SUPABASE_URL=http://127.0.0.1:54321
ANON_KEY="<the 'anon key' printed by \`supabase status\`>"

TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"athlete@example.com","password":"<the test password>"}' \
  | jq -r .access_token)

echo "${TOKEN:0:12}…"     # sanity check only; never paste a whole token anywhere
```

For a hosted project, use that project's URL and its `anon public` key from
**Project Settings → API**.

Alternatively, sign in to the PWA and read
`localStorage` → the `sb-…-auth-token` entry → `access_token`.

To see which signing algorithm your project uses (this decides whether you need
`SUPABASE_JWT_SECRET` at all):

```bash
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | jq .alg
# "HS256"                -> symmetric; SUPABASE_JWT_SECRET is required
# "RS256"/"ES256"/"EdDSA" -> asymmetric; no secret needed, JWKS is used
```

Set a base URL so the rest of the examples work locally or against production:

```bash
WORKER=http://localhost:8787
# WORKER=https://training-ai-worker.<subdomain>.workers.dev
ORIGIN=http://localhost:5173
```

### 20.1 Health

```bash
curl -s "$WORKER/health" | jq
```

Expect `200` and `{"status":"ok","service":"ai-worker","provider":…,"models":{…},"requestId":…}`.
No token, no `Origin` needed.

### 20.2 Authentication

Missing token — expect `401 unauthorized`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$WORKER/v1/workout-drafts/from-text" \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  -d '{"text":"x","timezone":"Europe/Madrid","idempotencyKey":"auth-test-001"}'
```

Garbage token — expect `401 unauthorized`:

```bash
curl -s -X POST "$WORKER/v1/workout-drafts/from-text" \
  -H "Origin: $ORIGIN" -H "Authorization: Bearer aaa.bbb.ccc" \
  -H "Content-Type: application/json" \
  -d '{"text":"x","timezone":"Europe/Madrid","idempotencyKey":"auth-test-002"}' | jq
```

Disallowed origin — expect `403 forbidden_origin`:

```bash
curl -s -X POST "$WORKER/v1/workout-drafts/from-text" \
  -H "Origin: https://not-allowed.example" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"x","timezone":"Europe/Madrid","idempotencyKey":"auth-test-003"}' | jq
```

Every error body has the same envelope, and `requestId` also comes back in the
`x-request-id` header so a user-reported failure is traceable without them
pasting a token or a transcript:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Bearer token is invalid or expired.",
    "requestId": "…",
    "details": null
  }
}
```

The full code list is in `packages/ai-contracts/src/errors.ts`:
`unauthorized` 401, `forbidden_origin` 403, `payload_too_large` 413,
`audio_too_long` 413, `upstream_error` 502, `schema_invalid` 422,
`rate_limited` 429, `not_found` 404.

### 20.3 Text parsing

```bash
curl -s -X POST "$WORKER/v1/workout-drafts/from-text" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "text": "Back squat 3x10 at 60 kg, then 20 minutes easy run",
        "timezone": "Europe/Madrid",
        "localDate": null,
        "preferredUnits": "metric",
        "idempotencyKey": "manual-2026-08-02-001",
        "context": { "exerciseAliases": [], "recentExerciseNames": [] }
      }' | jq
```

Field notes, all enforced by `FromTextRequestSchema` in
`packages/ai-contracts/src/api.ts`:

- `timezone` — IANA name, required. The Worker resolves "today" with it.
- `localDate` — `YYYY-MM-DD` or `null`. The client sends it so a recording made
  just after midnight keeps the right date.
- `idempotencyKey` — 8–128 URL-safe characters, generated by the client. The
  Worker namespaces it per user into the session's `clientRequestKey`, so a
  retried draft upserts instead of duplicating.
- `context` — optional alias and recent-name hints from the client's local
  cache. Keeping it small keeps prompts cheap (section 22).
- There is **no** `userId` field, anywhere. It would be a lie the server has to
  ignore.

The response is a workout draft (`WorkoutDraftSchema` in
`packages/ai-contracts/src/workout-draft.ts`):

- `resolvedLocalDate` — the date the sessions were resolved to. Spoken input
  says "yesterday"; the client shows this so a wrong day is visible before
  saving.
- `sessions[]` — one entry per independent session, each with `title`,
  `rawText` (verbatim source, never discarded), `activities[]`, `tags` and the
  namespaced `clientRequestKey`.
- `warnings[]` — this is how uncertainty is expressed. Each carries a `code`, a
  human-readable `message`, the exact `sourceFragment` that triggered it, and a
  `severity`. Blocking codes such as `AMBIGUOUS_LOAD_VALUE` and
  `UNRESOLVED_EXERCISE_ALIAS` are the ones that force human review.
- `unconsumedFragments[]` — spoken text that produced no structured record,
  with the parser's reason. This field exists so nothing said is lost silently.
- `metadata` — `provider`, `model`, `promptVersion`, `requestId`, `latencyMs`,
  `attempts`.

### 20.4 Audio transcription

Multipart, which is what `MediaRecorder` output maps onto most directly:

```bash
curl -s -X POST "$WORKER/v1/workout-drafts/from-audio" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'meta={"timezone":"Europe/Madrid","localDate":null,"preferredUnits":"metric","idempotencyKey":"voice-2026-08-02-001","mimeType":"audio/webm","durationSeconds":12,"language":null,"context":{"exerciseAliases":[],"recentExerciseNames":[]}}' \
  -F "audio=@/path/to/clip.webm;type=audio/webm" | jq
```

JSON variant, for a queued offline draft replayed from storage:

```bash
B64=$(base64 -i /path/to/clip.webm | tr -d '\n')
curl -s -X POST "$WORKER/v1/workout-drafts/from-audio" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"timezone\":\"Europe/Madrid\",\"idempotencyKey\":\"voice-json-001\",\"mimeType\":\"audio/webm\",\"durationSeconds\":12,\"audioBase64\":\"$B64\"}" | jq
```

Constraints, from `packages/ai-contracts/src/limits.ts` and
`src/handlers/from-audio.ts`:

- `mimeType` must be one of `audio/webm`, `audio/ogg`, `audio/mp4`,
  `audio/mpeg`, `audio/mpga`, `audio/wav`, `audio/x-m4a`, `audio/aac` (codec
  parameters like `;codecs=opus` are ignored when matching). Anything else is
  `422 schema_invalid` with `details.mimeType`.
- Over `MAX_AUDIO_BYTES` → `413 payload_too_large`.
- A stated `durationSeconds` over `MAX_AUDIO_SECONDS` → `413 audio_too_long`.
  `null` is accepted, since some recorders do not report a duration; the byte
  limit still bounds the work.
- The response adds `transcript` and `transcription` metadata to the draft, so
  the athlete can check what was heard. The audio itself is discarded when the
  response is sent.

### 20.5 Plan generation

```bash
curl -s -X POST "$WORKER/v1/plans/draft" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "timezone": "Europe/Madrid",
        "startLocalDate": "2026-08-03",
        "weeks": 2,
        "goal": "Build back squat strength while keeping two easy runs a week",
        "preferredUnits": "metric",
        "constraints": ["No training on Sundays", "Left knee: avoid deep lunges"],
        "recentSessions": [
          {"localDate":"2026-07-30","title":"Lower body","modalities":["strength"],"durationSeconds":3600,"sessionRpe":7}
        ],
        "notes": null
      }' | jq
```

`weeks` is 1–8. `recentSessions` is capped at 60 summaries and
`constraints` at 20 — those caps are the cost control, not a formality.

The optional explanation endpoint:

```bash
curl -s -X POST "$WORKER/v1/plans/explain" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "timezone": "Europe/Madrid",
        "previousSummary": "3 strength sessions, 2 runs",
        "proposedSummary": "2 strength sessions, 3 runs, lower volume",
        "signals": ["Reported knee soreness twice", "Session RPE trending up"],
        "notes": null
      }' | jq
```

### 20.6 Rate limiting

31 requests inside a minute from one user hits `429 rate_limited` with the
default `RATE_LIMIT_PER_MINUTE=30`:

```bash
for i in $(seq 1 31); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST "$WORKER/v1/workout-drafts/from-text" \
    -H "Origin: $ORIGIN" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"squat 1x1\",\"timezone\":\"Europe/Madrid\",\"idempotencyKey\":\"rl-$i-aaaa\"}"
done; echo
```

Run this against `AI_PROVIDER=mock`, not against live AI.

The 429 body carries `details.retryAfterSeconds` and `details.limitPerMinute`.
Be aware of what this limit is and is not: `src/rate-limit.ts` keeps the counter
in memory **per Worker isolate**, so the real ceiling is
`RATE_LIMIT_PER_MINUTE × number of live isolates`. It exists to stop one client
looping a model call, not to enforce a billing quota, and a global limit would
need Durable Objects or KV. Locally there is one isolate, so the loop above
behaves exactly as written; in production you may need more than 31 requests to
trip it.

## 21. Inspecting Worker logs and Workers AI usage

### Live logs

```bash
cd apps/ai-worker
npx wrangler tail                                   # stream production logs
npx wrangler tail --format pretty
npx wrangler tail --status error                    # only failures
npx wrangler tail --search "<request-id>"           # trace one reported failure
npx wrangler tail --env staging
```

`wrangler tail` attaches to the deployed Worker and streams as requests arrive;
it shows nothing while idle. `wrangler dev` prints the same log lines straight
to your terminal.

Logs are structured JSON produced by `src/log.ts`, and are deliberately
metadata-only: request id, path, method, provider, counts, sizes, latency,
attempts. **Bearer tokens, audio bytes and transcript text are never logged at
any level**, including `LOG_LEVEL=debug`. When a user reports a failure, ask
them for the `requestId` shown in the error, then `--search` for it.

### Dashboard

`"observability": { "enabled": true }` in `wrangler.jsonc` is what makes these
views useful:

- **Workers & Pages → `training-ai-worker` → Logs** — retained recent
  invocations, filterable and searchable.
- **Workers & Pages → `training-ai-worker` → Metrics** — requests, errors,
  CPU time, subrequests.
- **AI → Workers AI** — inference usage, broken down by model, measured in
  Cloudflare's "Neurons". This is the page that tells you what the app is
  actually spending. Check it after the first live smoke test, then weekly.
- **Notifications** — set a usage or error-rate alert so a runaway loop reaches
  you by email rather than by invoice.

## 22. Avoiding surprise costs

Workers AI is metered. The defences are layered, and most of them are already in
the code.

**App-level limits, enforced before any model call** (`vars` in
`wrangler.jsonc`, defaults in `packages/ai-contracts/src/limits.ts`):

| Limit                   | Default        | Stops                                              |
| ----------------------- | -------------- | -------------------------------------------------- |
| `MAX_AUDIO_SECONDS`     | 300 (5 min)    | Long recordings; STT cost scales with duration      |
| `MAX_AUDIO_BYTES`       | 10 MiB         | Oversized uploads regardless of stated duration     |
| `MAX_TEXT_CHARS`        | 12 000         | A huge transcript reaching the parser               |
| `MAX_JSON_BODY_BYTES`   | 128 KiB        | Oversized JSON bodies                               |
| `RATE_LIMIT_PER_MINUTE` | 30 per user    | Loops, double-taps, a stuck retry (per isolate)     |

Lower them for a personal deployment. There is no downside to
`MAX_AUDIO_SECONDS=120` if you never speak for two minutes.

**Request quotas.** The limits live in `packages/ai-contracts/src/limits.ts`
rather than only in the Worker, so the browser can refuse a too-long recording
before spending the upload — a client-side check costs nothing, and the Worker
enforces the same numbers regardless. Cloudflare also has an account-level free
allocation and per-model pricing, both metered in "Neurons": read the current
figures on <https://developers.cloudflare.com/workers-ai/platform/pricing/>
rather than trusting a number written here, and set a dashboard notification at
a fraction of whatever it says.

**Short prompts.** The prompts in
`src/providers/cloudflare/prompts.ts` describe the output contract in prose
rather than shipping a generated JSON Schema, which for the full session draft
would be thousands of tokens on every single request. They are versioned
(`workout-parser/1`, `planner/1`, `stt/1`) and the version is stored on every
draft, so a regression traces back to the prompt that caused it.

**A bounded retry.** `src/schema-retry.ts` allows *at most one* repair attempt,
and the retry feeds the Zod validation issues back as a hint rather than blindly
re-rolling. There is no open-ended loop anywhere. The hard ceiling is two model
calls for a text request and three for an audio one (one STT plus up to two
parser calls), and `metadata.attempts` on every response tells you which
happened.

**Compact context.** The client sends only what the parser needs — capped alias
hints (400) and recent exercise names (200), and at most 60 recent-session
summaries for planning. Summaries, not full records. Sending an athlete's entire
history on every request would be the single most expensive mistake available.

**Dashboard monitoring.** `AI → Workers AI` weekly, plus a notification. Two
minutes of setup covers the case where a bug ships on a Friday.

**Development discipline.** `AI_PROVIDER=mock` unless you are deliberately
testing live inference (section 13). This is the single largest saving
available, because development makes far more requests than use does.

## 23. Troubleshooting

### CORS errors in the browser

Symptom: the browser console says the response is missing
`Access-Control-Allow-Origin`, or the request shows as blocked; `curl` shows
`403` with `{"code":"forbidden_origin"}`.

- The origin must be listed in `ALLOWED_ORIGINS` **exactly** — scheme, host and
  port. `http://localhost:5173` does not match `http://127.0.0.1:5173`, and
  neither matches `https://localhost:5173`.
- Vite sometimes picks a different port when 5173 is busy. Check what it printed
  and add that origin.
- With `curl`, remember `/v1` requires an `Origin` header at all. No header is
  also `403`.
- After changing `ALLOWED_ORIGINS` you must redeploy (production) or restart
  `wrangler dev` (local). It is baked into the deployment.
- Check `/health` on the deployed Worker first. If that fails too, the problem
  is not CORS.

### 401 unauthorized

Work through these in order:

1. **No or malformed header.** It must be exactly
   `Authorization: Bearer <token>`, and the token must have three
   dot-separated segments.
2. **Expired token.** Supabase access tokens are short-lived. Fetch a fresh one;
   in the browser, `supabase.auth.getSession()` refreshes automatically.
3. **Issuer mismatch.** The token's `iss` must equal `SUPABASE_JWT_ISSUER`, which
   defaults to `${SUPABASE_URL}/auth/v1`. **The most common production failure
   is deploying with the committed `SUPABASE_URL=http://127.0.0.1:54321`** while
   signing in against a hosted project. Fix the `var` and redeploy.
4. **Wrong key mechanism.** Decode the header (section 20.0). `HS256` needs
   `SUPABASE_JWT_SECRET` — if it is unset you get "Symmetric tokens are not
   accepted: no JWT secret is configured." An asymmetric token needs a reachable
   JWKS URL; if `SUPABASE_URL` is unset you get "Asymmetric tokens are not
   accepted: no JWKS URL is configured."
5. **Wrong secret.** A rotated Supabase JWT secret must be re-set with
   `npx wrangler secret put SUPABASE_JWT_SECRET`.
6. **Anon key used as a token.** The anon key is a valid JWT but its `aud` is
   `anon`, not `authenticated`, so the Worker rejects it: "Bearer token is not
   an authenticated user token." Sign a user in and use their access token.
7. **JWKS unreachable from Cloudflare.** A Worker cannot reach your
   `127.0.0.1`. A deployed Worker needs a publicly reachable Supabase project.

Error messages are deliberately coarse and never echo token contents. Use the
`requestId` with `wrangler tail --search` to see the server side.

### Microphone and audio-format failures

- **No microphone prompt at all.** `getUserMedia` requires a secure context:
  HTTPS, or `http://localhost` (which browsers treat as secure).
  `http://192.168.x.x:5173` on a phone will not work — that is what the deployed
  HTTPS PWA is for.
- **Permission denied.** iOS Safari and Chrome both need the site's microphone
  permission re-granted per origin; check Settings → the site → Microphone. The
  app should show a clear message and keep the text-entry fallback available.
- **`422 schema_invalid` with `details.mimeType`.** The recorder produced a
  format not in the supported list. Safari typically produces `audio/mp4`,
  Chrome `audio/webm;codecs=opus`; both are supported. Log
  `MediaRecorder.isTypeSupported(...)` results and pick a supported type at
  capture time rather than converting afterwards.
- **`413 audio_too_long`.** The client reported more than `MAX_AUDIO_SECONDS`.
  The visible timer and app-level cap should prevent this from ever reaching the
  Worker.
- **`502 upstream_error` on a recording that plays fine.** Suspect the STT
  payload shape before the file: see section 15, step 4.
- **Empty transcript** → `502 upstream_error` with "The recording produced an
  empty transcript." Usually silence, a muted input, or the wrong device
  selected.

### Schema failures (`422 schema_invalid`)

This code means one of two things, and `details` tells you which:

- **Your request** did not validate. `details` carries the failing field paths.
  Compare against `packages/ai-contracts/src/api.ts` — most often a missing
  `timezone`, or an `idempotencyKey` shorter than 8 characters.
- **The model's output** did not validate after one repair attempt. This is a
  refusal, not a bug: the Worker returns an error rather than a
  partially-guessed draft. Check `metadata.attempts` on successful responses; if
  it is regularly 2, the parser model is struggling with structured output and
  the honest fix is a different model, not a longer prompt.

Reproduce request-shape problems for free with `AI_PROVIDER=mock`.

### Model deprecation

Symptom: `502 upstream_error` with `details.model` naming your configured ID and
a `details.detail` message from Cloudflare about an unknown or retired model.
Everything else in the app keeps working, which is the intended blast radius.

1. Open <https://developers.cloudflare.com/workers-ai/models/> and find the
   current replacement.
2. Change the ID in `wrangler.jsonc` (and `.dev.vars` locally).
3. Re-run the live smoke test (section 15) — a replacement model can accept a
   different input shape or be worse at structured output.
4. Redeploy and confirm with `/health`, which echoes the configured IDs.

### Missing bindings

Symptom: `502 upstream_error` — "The Workers AI binding is not configured."
This one is unusual because it surfaces on `GET /health` too, since `/health`
constructs the providers in order to report them.

- Confirm `"ai": { "binding": "AI" }` is present in `wrangler.jsonc` and that
  you deployed *after* adding it.
- Confirm the name matches the code: the config says `AI`, and `env.ts` reads
  `env.AI`.
- Confirm Workers AI is enabled on the account (section 3).
- A related message, "Model configuration `STT_MODEL` is missing.", means the
  variable is empty or absent. There is no hard-coded fallback on purpose.
- If `/health` reports `"provider": "mock"` when you expected `cloudflare`, the
  cause is `AI_PROVIDER`, not the binding: any value other than the exact string
  `cloudflare` resolves to `mock`.

## 24. Staging and production Worker environments

Wrangler environments let one config file describe several Workers. Add a named
environment to `wrangler.jsonc`:

```jsonc
{
  "name": "training-ai-worker",
  // ... top level = production ...

  "env": {
    "staging": {
      "name": "training-ai-worker-staging",
      "vars": {
        "AI_PROVIDER": "cloudflare",
        "STT_MODEL": "@cf/openai/whisper-large-v3-turbo",
        "WORKOUT_PARSER_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
        "PLANNER_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
        "ALLOWED_ORIGINS": "https://staging.training.example.com",
        "SUPABASE_URL": "https://<staging-project-ref>.supabase.co",
        "MAX_JSON_BODY_BYTES": "131072",
        "MAX_AUDIO_BYTES": "10485760",
        "MAX_AUDIO_SECONDS": "300",
        "MAX_TEXT_CHARS": "12000",
        "RATE_LIMIT_PER_MINUTE": "30"
      }
    }
  }
}
```

Three things to internalise:

- **`vars` do not merge.** A named environment's `vars` block replaces the
  top-level one entirely, so every variable it needs must be repeated. Missing
  ones fall back to code defaults, and a missing `AI_PROVIDER` silently means
  `mock`.
- **Bindings do not inherit either.** If a named environment needs Workers AI,
  give it its own `"ai": { "binding": "AI" }`.
- **Secrets are per environment.** `wrangler secret put X` and
  `wrangler secret put X --env staging` are different stores.

Working with environments:

```bash
cd apps/ai-worker
npx wrangler dev --env staging
npx wrangler deploy --env staging
npx wrangler secret put SUPABASE_JWT_SECRET --env staging
npx wrangler tail --env staging
npx wrangler delete --env staging
```

Each environment is a separate Worker with its own URL —
`https://training-ai-worker-staging.<subdomain>.workers.dev` — so point the
staging PWA's `VITE_AI_WORKER_URL` at it, and pair it with a staging Supabase
project so a staging token cannot be used against production data.

For a single-athlete project, one production Worker plus `mock` locally is
enough. Add staging when someone else starts using the app.

## 25. Optional: deploying from CI with a scoped API token

**Not required.** Local development and `npx wrangler deploy` from a laptop need
none of this. Set it up only when you want pushes to `main` to deploy.

CI cannot run an interactive OAuth login, so it uses an API token instead.

1. Dashboard → profile menu → **My Profile → API Tokens → Create Token**.
2. Start from the **Edit Cloudflare Workers** template, or create a custom token
   with the minimum permissions:
   - Account → **Workers Scripts** → Edit
   - Account → **Workers AI** → Edit (needed for the `ai` binding)
   - Account → **Account Settings** → Read
   - Scope it to the **one account** that owns this Worker.
3. Do **not** use a Global API Key. It is account-wide and cannot be scoped.
4. Copy the token once — it is not shown again — and store it as a repository
   secret named `CLOUDFLARE_API_TOKEN`. Store the account ID as
   `CLOUDFLARE_ACCOUNT_ID`.

Wrangler picks both up from the environment automatically:

```yaml
# .github/workflows/deploy-worker.yml  (illustrative; not committed)
name: Deploy AI Worker
on:
  push:
    branches: [main]
    paths: ["apps/ai-worker/**", "packages/ai-contracts/**", "packages/domain/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @training/ai-worker typecheck
      - run: pnpm --filter @training/ai-worker test
      - run: pnpm --filter @training/ai-worker exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

The test step runs entirely on the `mock` provider, so CI never spends
inference. Rotate the token if it is ever exposed: **API Tokens → Roll**, then
update the repository secret.

Runtime secrets such as `SUPABASE_JWT_SECRET` are **not** set by CI. They live
in Cloudflare from `wrangler secret put` and persist across deploys, so CI never
needs to know them.

## 26. Removing the Worker and its secrets completely

Deleting the Worker deletes its `vars`, its secrets and its `workers.dev` route.
It does not touch Supabase, and the app keeps working with typed entry once
`VITE_AI_WORKER_URL` is blank.

```bash
cd apps/ai-worker

# 1. See what exists.
npx wrangler deployments list
npx wrangler secret list

# 2. Optional, if you want secrets gone before the Worker.
npx wrangler secret delete SUPABASE_JWT_SECRET

# 3. Delete the Worker. Prompts for confirmation.
npx wrangler delete

# 4. Any named environments are separate Workers and need separate deletes.
npx wrangler delete --env staging
```

Then, outside Cloudflare:

```bash
# 5. Disable voice in the frontend: blank the variable in apps/web/.env
#    VITE_AI_WORKER_URL=
#    and rebuild/redeploy the PWA.

# 6. Remove local credentials.
rm apps/ai-worker/.dev.vars      # keep .dev.vars.example
npx wrangler logout              # clears Wrangler's stored OAuth token
```

If a CI token was created (section 25), delete it at **My Profile → API
Tokens**, and remove the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
repository secrets. Rotate the Supabase JWT secret too if it was ever set as a
Worker secret and you want it invalidated.

Verify the Worker is gone:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://training-ai-worker.<subdomain>.workers.dev/health
# expect a Cloudflare error page / non-200, not {"status":"ok"}
```

To delete the Cloudflare account itself: **My Profile → Preferences → Delete
account**. Keeping an empty account costs nothing.

---

## Reference: where each value comes from

| Value                          | Source                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| Cloudflare account ID          | `npx wrangler whoami`, or the dashboard URL                               |
| `workers.dev` subdomain        | `npx wrangler deploy` output, or Workers & Pages → Subdomain              |
| Worker URL                     | `https://training-ai-worker.<subdomain>.workers.dev`                      |
| Workers AI model IDs           | <https://developers.cloudflare.com/workers-ai/models/>                    |
| `SUPABASE_URL` (local)         | the `API URL` printed by `supabase status`                                |
| `SUPABASE_URL` (hosted)        | Supabase dashboard → Project Settings → API → Project URL                 |
| `SUPABASE_JWT_SECRET` (local)  | the `JWT secret` printed by `supabase status`                             |
| `SUPABASE_JWT_SECRET` (hosted) | Supabase dashboard → Project Settings → API → JWT Settings                |
| `VITE_SUPABASE_ANON_KEY`       | the `anon key` printed by `supabase status`, or Project Settings → API     |
| Bearer token for `curl`        | `POST /auth/v1/token?grant_type=password` (section 20.0)                  |
| `ALLOWED_ORIGINS` (local)      | the origin the Vite dev server prints, normally `http://localhost:5173`   |
| `ALLOWED_ORIGINS` (production) | the origin the PWA is deployed to                                         |
| Limits and their defaults      | `packages/ai-contracts/src/limits.ts`                                     |
| Error codes and statuses       | `packages/ai-contracts/src/errors.ts`                                     |
| CI API token                   | Cloudflare dashboard → My Profile → API Tokens                            |
