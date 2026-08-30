# Cloudflare checklist — what to do, in order, and where

The companion to [`CLOUDFLARE_WORKERS_AI_SETUP.md`](./CLOUDFLARE_WORKERS_AI_SETUP.md),
which is 1,400+ lines of reference material for looking things up. This is just
the things you do, in order, and every step says **where it happens** — your Mac's
terminal, your browser at Cloudflare, or a file in your editor. Nothing here is
invented: every command is a script in this repo or a command from the long guide.

**Verified vs not.** Part 1 was run end to end on this machine: 135 Worker tests
pass and `/health` returns `"provider": "mock"`. Part 2 has **never been
executed** — nobody on this project has a Cloudflare account yet, so it comes from
Cloudflare's documented behaviour, and CLI output and dashboard labels move.

---

## Part 1 — On your machine. No Cloudflare account, no signup, no cost.

### 1. Check Node and pnpm

**Where:** terminal, anywhere.

```bash
node --version    # must print v20.x or newer
pnpm --version    # must print 11.5.2
```

**Why:** `engines.node` and `packageManager` in the root `package.json` pin these;
a mismatched pnpm resolves different dependency versions.
**Worked when:** two version numbers print. If pnpm is wrong, run `corepack enable && corepack prepare pnpm@11.5.2 --activate`.

### 2. Install dependencies

**Where:** terminal, at the **repo root**. This is a local command that writes
`node_modules/` — not something you run in GitHub or in Cloudflare.

```bash
pnpm install
```

**Why:** installs all 7 workspace projects at once, including the `wrangler` CLI
and `workerd` (the Workers runtime) that later steps need. You never install
`wrangler` globally.
**Worked when:** `Scope: all 7 workspace projects` … `Done in …`. If a later step cannot find `workerd`, re-run this rather than installing anything globally.

### 3. Create your local Worker env file

**Where:** terminal, in `apps/ai-worker/`.

```bash
cd apps/ai-worker
cp .dev.vars.example .dev.vars
```

**Why:** `.dev.vars` is what `wrangler dev` reads, and it ships
`AI_PROVIDER=mock` — the setting that keeps local development from spending money.
It is gitignored; the `.example` is the committed template. **Do not skip this
one:** with no `.dev.vars`, `wrangler.jsonc` supplies `AI_PROVIDER=cloudflare`
instead, so you get a Worker wired for live billable inference without being told.
(Confirmed here by deleting the file: `/health` flipped to `"cloudflare"`.)
**Worked when:** `apps/ai-worker/.dev.vars` exists. Nothing in it is a real credential.

### 4. Run the Worker's tests

**Where:** terminal, anywhere in the repo.

```bash
pnpm --filter @training/ai-worker test
```

**Why:** proves the whole AI backend is sound before Cloudflare is involved — the
tests call the request handler directly with a fake `env`, so no network, no
runtime, no account.
**Worked when:** `Test Files 7 passed (7)`, `Tests 135 passed (135)`. The JSON lines scrolling past are the Worker's own logs, not errors.

### 5. Start the Worker locally

**Where:** terminal, in `apps/ai-worker/`. Leave it running.

```bash
npx wrangler dev
```

**Why:** runs your code on `workerd`, the same runtime Cloudflare uses in
production, reading `.dev.vars` on top of `wrangler.jsonc`.
**Worked when:** `Using secrets defined in .dev.vars`, a bindings table, then
`Ready on http://localhost:8787`. It also warns that **AI bindings access remote
resources even in local dev** — true, and exactly why step 3 leaves the provider on
`mock`, which calls no model at all.

> **Read the port it actually prints.** If 8787 is taken — including by a
> `wrangler dev` you thought you had stopped — Wrangler moves to 8788 without
> failing. Both happened while verifying this, and the consequence is nastier than
> it sounds: your `curl localhost:8787` then reaches the _stale_ Worker, which may
> be running different configuration than the file you just edited.

### 6. Confirm the Worker answers

**Where:** a **second** terminal tab — the first is busy running the Worker.

```bash
curl -s http://localhost:8787/health | jq
```

**Why:** `/health` echoes the resolved configuration without needing a token, so a
wrong provider or a bad model ID shows up in one request.
**Worked when** you get this, and `"provider": "mock"` is the line that matters:

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

### 7. The full local loop: three terminals

**Where:** terminal, three tabs, all left running.

```bash
supabase start                                  # tab 1 — auth + database. Needs Docker running.
cd apps/ai-worker && npx wrangler dev           # tab 2 — the Worker, on :8787
pnpm --filter @training/web dev                 # tab 3 — the PWA, on :5173
```

**Why:** the browser needs all three — Supabase to log in and store data, the
Worker for voice, Vite to serve the app.
**Worked when:** `supabase start` prints an `API URL`, `anon key` and `JWT secret`
(save these; Part 3 needs them) and Vite prints `http://localhost:5173/`.

> **Gotcha, hit while verifying this:** if port 5173 is taken, Vite quietly moves
> to `http://localhost:5174/`, which is **not** in `ALLOWED_ORIGINS`, and every
> voice request then fails `403 forbidden_origin`. Free 5173, or add the port Vite
> actually printed to `ALLOWED_ORIGINS`.

---

## Part 2 — In Cloudflare. Browser plus terminal. **Unverified.**

Not needed until you want voice to work somewhere other than your own machine.

### 8. Create the account

**Where:** browser → <https://dash.cloudflare.com/sign-up> (or `/login`).

**Why:** `workers.dev` subdomains and the Workers AI free allocation need no
domain name and no credit card.
**Worked when:** you reach the dashboard. While there, visit **AI → Workers AI** once so the usage charts exist to look at later.

### 9. Log the CLI in to that account

**Where:** terminal in `apps/ai-worker/`; it opens your browser to approve.

```bash
npx wrangler login
npx wrangler whoami
```

**Why:** the OAuth token lands in your home folder, not the repo, so there is
nothing to commit by accident.
**Worked when:** `whoami` prints your email and account ID.

### 10. Check the model ID is still current

**Where:** browser → <https://developers.cloudflare.com/workers-ai/models/>.

**Why:** a deprecated ID fails at the first real request, not at deploy. Since
the 2026-08 simplification the Worker calls exactly one model — Whisper for
transcription. There is no parser and no planner any more; the transcript is
saved as-is and the athlete adds structure by hand if they want it.

**Worked when:** `@cf/openai/whisper-large-v3-turbo` is present and
non-deprecated. If it moves, change only `STT_MODEL` — model IDs live nowhere
else.

### 11. Fix `wrangler.jsonc` before deploying — do not skip this

**Where:** a file in your editor: `apps/ai-worker/wrangler.jsonc`.

It ships **local** values in `vars`. Replace both:

```jsonc
"SUPABASE_URL": "http://127.0.0.1:54321",                              // -> "https://<project-ref>.supabase.co"
"ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",      // -> "https://<your-pwa-origin>"
```

**Why:** the one step that breaks everything if skipped. A deployed Worker cannot
reach `127.0.0.1` — that address means _itself_, not your Mac — so it cannot fetch
Supabase's JWKS and **every `/v1` request fails 401 unauthorized**. Separately, a
PWA on any other origin gets `403 forbidden_origin`; origins match exactly, no
wildcards or suffixes.
**Worked when:** after deploying, real requests succeed instead of returning a wall of 401s.

### 12. Set the JWT secret — HS256 projects only

**Where:** terminal in `apps/ai-worker/`. It prompts on stdin, so the value never
reaches your shell history.

```bash
npx wrangler secret put SUPABASE_JWT_SECRET
```

**Why:** needed only if your Supabase project still signs with a symmetric HS256
key. Projects on `RS256`/`ES256`/`EdDSA` need **no secret** — the Worker verifies
against the public JWKS it fetches from `SUPABASE_URL`.
**Worked when:** `npx wrangler secret list` shows the name (never the value).

### 13. Deploy

**Where:** terminal in `apps/ai-worker/`.

```bash
pnpm --filter @training/ai-worker typecheck
pnpm --filter @training/ai-worker test
npx wrangler deploy
```

**Why:** this upload is also what activates Workers AI on a fresh account, and it
creates your `workers.dev` subdomain if you have not picked one.
**Worked when:** it prints `https://training-ai-worker.<subdomain>.workers.dev` and a version ID. Copy that URL.

### 14. Point the PWA at the deployed Worker

**Where:** one file in your editor: `apps/web/.env.local`. That is the only
populated env file the web app should have. Do **not** also create
`apps/web/.env` — Vite loads `.env.local` in production builds too, so whichever
file holds localhost wins and gets baked into a build meant for the deployed
site. Production values belong in Vercel (step 16), never on disk.

```bash
VITE_AI_WORKER_URL=https://training-ai-worker.<subdomain>.workers.dev
```

**Why:** **no trailing slash** — the client appends paths like
`/v1/workout-drafts/from-text`. Blank is a valid state: voice switches off and
manual entry keeps working. Leave it blank locally unless you are deliberately
testing voice; `e2e/history.spec.ts` asserts the recorder is disabled.
**Worked when:** after restarting the dev server the recorder is enabled instead of showing "Voice entry needs VITE_AI_WORKER_URL".

### 15. Confirm the deployed Worker really uses Cloudflare

**Where:** terminal.

```bash
curl -s https://training-ai-worker.<subdomain>.workers.dev/health | jq
```

**Why:** the one check that catches a deploy which silently kept the mock provider.
**Worked when:** `"provider": "cloudflare"` and
`"models": { "stt": "@cf/openai/whisper-large-v3-turbo" }`. If it says `mock`,
the deployed `vars` are wrong and the app is returning a fabricated transcript.

### 16. Give Vercel the three environment variables

**Where:** browser → Vercel → your project → **Settings → Environment
Variables**. Set all three for **Production and Preview**:

| Name                     | Value                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`      | the hosted project URL — bare, **no `/rest/v1`**, no trailing slash |
| `VITE_SUPABASE_ANON_KEY` | the hosted publishable key (`sb_publishable_…`)                     |
| `VITE_AI_WORKER_URL`     | `https://training-ai-worker.<subdomain>.workers.dev`                |

**Why:** nothing on your machine reaches Vercel — every populated env file is
gitignored, so these three exist only here. Two failure modes, both silent:

- **Unset.** `apps/web/src/lib/supabase.ts` throws at module load, the minifier
  folds the guard into an unconditional top-level `throw`, React never mounts,
  and you get a bare dark-blue page with no console-visible cause.
- **`/rest/v1` appended to the URL.** supabase-js builds its auth endpoint with
  `new URL('auth/v1', baseUrl)`, so sign-in POSTs to `/rest/v1/auth/v1/token` and
  returns `404 PGRST125 Invalid path specified in request URL`. Login can never
  succeed no matter what you type. A correct URL rejects a bad password with
  `400 invalid_credentials` — that is the response that proves auth is wired up.

Then **redeploy**. Vite inlines `import.meta.env.*` at build time, so saving a
variable changes nothing until a new build runs.

**Worked when:** the deployed `assets/index-*.js` contains your project URL and
no `/rest/v1/auth`, and the sign-in form appears instead of an empty page. If it
still looks broken, the `registerType: "autoUpdate"` service worker is serving
the cached old build — hard-reload, or unregister it under DevTools →
Application → Service Workers.

**Also needed for a Vite SPA:** a `vercel.json` (next to whatever you set as the
project's **Root Directory**) rewriting everything to `/index.html`, or
`/history`, `/record` and `/more` return 404 on direct load and refresh. It must
be **committed and pushed** — Vercel builds from git, so an untracked file on
your machine has no effect.

---

## Part 3 — The six values you have to fetch yourself

| Value                   | The one command or click-path that produces it                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `workers.dev` subdomain | printed by `npx wrangler deploy` — or browser → **Workers & Pages → Subdomain**                  |
| Supabase anon key       | the `anon key` from `supabase status` — or browser → **Project Settings → API**                  |
| Supabase JWT secret     | the `JWT secret` from `supabase status` — or browser → **Project Settings → API → JWT Settings** |
| Supabase project URL    | the `API URL` from `supabase status` — or browser → **Project Settings → API → Project URL**     |
| Your PWA's origin       | local: the URL the Vite dev server prints. Production: wherever you deployed the PWA             |
| The STT model ID        | browser → <https://developers.cloudflare.com/workers-ai/models/>                                 |

---

## Part 4 — Day to day, and how to undo it

**Redeploy after editing configuration.** Terminal in `apps/ai-worker/`. Editing
`vars` in `wrangler.jsonc` changes nothing until `npx wrangler deploy` runs again;
the deployed Worker holds its own copy.

**Debug a deployed Worker.** Terminal in `apps/ai-worker/`:

```bash
npx wrangler tail --format pretty
npx wrangler tail --status error
npx wrangler tail --search "<request-id>"
```

Logs are metadata only — tokens, audio and transcript text are never logged at any
level. Errors surface a `requestId`; `--search` for it.

**Check spend.** Browser → **AI → Workers AI**: usage per model, in Cloudflare's
"Neurons". Look after your first live test, then weekly, and set a
**Notifications** alert so a runaway loop reaches you by email rather than by
invoice. Read prices off Cloudflare's pricing page, not off a number in this repo.

**The habit that keeps the bill at zero.** Keep `AI_PROVIDER=mock` unless you are
deliberately testing live inference — development makes far more requests than
actual use does, so this is the single largest saving available. `wrangler dev`
does **not** run models on your Mac: with `cloudflare` selected every call is
proxied to Cloudflare against your real account, so a hot-reload loop costs what
production would. For a time-boxed live test, override without editing any file:

```bash
npx wrangler dev --var AI_PROVIDER:cloudflare
```

**Remove it all.** Terminal in `apps/ai-worker/`, then one file in your editor:

```bash
npx wrangler secret delete SUPABASE_JWT_SECRET   # optional; secrets go with the Worker anyway
npx wrangler delete                              # prompts for confirmation
rm apps/ai-worker/.dev.vars                      # keep .dev.vars.example
npx wrangler logout
```

Then blank `VITE_AI_WORKER_URL=` in `apps/web/.env.local` — and in Vercel, if the
site is deployed — and rebuild the PWA. Voice
switches off, typed entry and everything else keeps working, and Supabase is
untouched. An empty Cloudflare account costs nothing to keep.
