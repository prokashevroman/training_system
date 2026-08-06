## Context

The Cloudflare guide is 1,438 lines of reference material. It never says where a command runs, which is why "pnpm install" produced the question "In GitHub? In the editor? In Cloudflare?"

Add a short companion doc: the steps you actually perform, each saying plainly where it happens and why it matters. The long guide stays as-is for looking things up.

## What to create

docs/CLOUDFLARE_CHECKLIST.md, around 150 lines.

Format per step: a numbered title, where it happens (your Mac's terminal / your browser at Cloudflare / a file in your editor), the exact command or click-path, one line on why it matters, and what you should see when it worked.

## Contents

Part 1, on your machine, no Cloudflare account needed. Check Node 20+ and pnpm 11.5.2, then pnpm install at the repo root, cp .dev.vars.example .dev.vars, pnpm --filter @training/ai-worker test, npx wrangler dev, and curl localhost:8787/health showing provider mock. Plus the three-terminal local loop: supabase start, wrangler dev, and the Vite dev server. Everything here is free and works today with no signup.

Part 2, in Cloudflare, browser plus terminal. Sign up at dash.cloudflare.com, npx wrangler login, check the three model IDs are still current, then edit wrangler.jsonc because it ships SUPABASE_URL as 127.0.0.1 and localhost origins and deploying as-is breaks every request with 401, then wrangler secret put SUPABASE_JWT_SECRET for HS256 projects only, npx wrangler deploy, copy the printed URL into apps/web/.env, and confirm /health now says cloudflare.

Part 3, values you have to fetch yourself. Six of them: subdomain, anon key, JWT secret, project URL, PWA origin, model IDs. Each with the one command or click-path that produces it.

Part 4, day-to-day and undo. Redeploy after editing vars, wrangler tail to debug, check spend under AI then Workers AI, keep AI_PROVIDER on mock unless deliberately testing live since that is the main way to avoid a bill, and how to delete the Worker and turn voice off.

Also add two lines at the top of CLOUDFLARE_WORKERS_AI_SETUP.md pointing to the new doc.

## Verification

Every step names where it runs and what success looks like. Every command exists in the repo's package.json scripts or the long guide, with nothing invented. Run Part 1 end to end here since it needs no account, and it must end with /health returning provider mock. Part 2 stays unverified because no Cloudflare account exists yet, and the doc says so, matching the honesty of the long guide.
