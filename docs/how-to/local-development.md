# Local development with production parity

Run the app locally so it **mirrors production** (engine, auth flow, schema, env-var
structure) while staying **isolated** from prod data and the real Meta account.

## Why this exists (the trap)

Production runs `AUTH_MODE=supabase` (per-operator auth: login is **email + senha**, and every
enqueued `agent_jobs` row is stamped with the operator's `operator_id`). The Fly runner, after the
multi-operator cutover, only claims **operator-scoped** jobs.

If local dev runs without `AUTH_MODE` set, `env.authMode()` falls back to **`password`** (single
shared password, no operator). Symptoms:

- `/login` shows **only "Senha"** (no email field).
- Jobs you enqueue via Ultron are written with `operator_id = null` → the runner can **never claim
  them** → they sit `pending` forever.

That is not a bug — it's a parity gap. Fix it by making local mirror prod's auth mode against an
**isolated** local database.

> Isolation matters: by default the repo's env points the app at the **production** Supabase, and
> the **production** Fly runner executes whatever lands in the queue — so a local test can create a
> **real (paused) Meta campaign**. The setup below uses a local Supabase instead, so nothing you do
> locally touches prod data or the real ad account.

## Prerequisites

- **Docker Desktop** running, with **WSL integration enabled** (Settings → Resources → WSL
  Integration) if you're on WSL. Check: `docker version` must print a Server version.
- Supabase CLI (no global install needed): use `npx supabase ...`.

## Steps

### 1. Start the isolated local stack

```bash
npx supabase start
```

This boots local Postgres 16 + Auth + Studio (Docker) and prints the **API URL**, **anon key**, and
**service_role key**. Keep that output — you need it in step 3.

### 2. Apply the schema + seed

```bash
npx supabase db reset
```

Runs all migrations in `supabase/migrations/` (same schema + RLS as prod) and then `supabase/seed.sql`,
which creates a **dev operator** and a **dev client**:

- Login: **`bruno@b2tech.io` / `localdev123`** (local-only credentials — same email as the
  prod operator for ergonomics, but a SEPARATE local account with a weak local password; shares
  nothing with prod). The address needs a real domain/TLD: the login endpoint validates with
  `z.string().email()`, which rejects dotless hosts like `dev@localhost` with a `400`.

### 3. Point the web app at the local stack

Create `web/.env.local` (gitignored) with:

```dotenv
# Auth: MUST match production (supabase). Without it, dev runs single-password mode and
# enqueues agent_jobs with operator_id=null (runner can't claim them).
AUTH_MODE=supabase

# Local Supabase (copy values from the `npx supabase start` output)
SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY (sb_publishable_...) from `supabase start`>
SUPABASE_SECRET_KEY=<SECRET_KEY (sb_secret_...) from `supabase start`>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Disable Cloudflare Turnstile locally. The prod widget can't resolve on localhost
# (ERR_NAME_NOT_RESOLVED / error 600010) and blocks login. Empty here = captcha skipped.
CLOUDFLARE_TURNSTILE_SITE_KEY=
CLOUDFLARE_TURNSTILE_SECRET_KEY=

# Required by env.ts even in supabase mode (read unconditionally). Local-only values:
AUTH_SECRET=local-dev-only-change-me-0123456789abcdef0123456789abcdef
DASHBOARD_PASSWORD=unused-in-supabase-mode

# Optional app keys — leave blank to disable that feature locally, or use your own DEV keys.
CLAUDE_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

`web/next.config.ts` loads this file **last, with `override: true`**, so these local values win over
the repo-root `.env.local` (the canonical prod-secrets home) and over any prod vars exported in your
shell. That is what makes `npm run dev` safe — see the note in step 4.

### 4. Run the app

```bash
cd web && npm run dev
```

Open `http://localhost:3000`. `/login` now shows **Email + Senha**. Log in with
`bruno@b2tech.io` / `localdev123`.

> **Why plain `npm run dev` is safe here.** Next.js lets variables already present in
> `process.env` **override** `web/.env.local`, and `next.config.ts` also loads the repo-root
> `.env.local` (the canonical prod-secrets home). Either could silently point dev at prod —
> `AUTH_MODE=supabase` against the prod DB is the dangerous combo — and leak the prod
> **Cloudflare Turnstile** keys, so the login captcha renders on localhost and fails
> (`ERR_NAME_NOT_RESOLVED` / error `600010`), blocking login. To make the local file authoritative,
> `next.config.ts` loads `web/.env.local` **last with `override: true`** (it is gitignored and never
> deployed, so Vercel is unaffected). That single override — not a shell hack — is what keeps dev
> isolated; the empty Turnstile keys above then disable the captcha (the endpoint skips it when the
> secret is absent).

### 5. Verify parity

Enqueue something via Ultron, then check the **local** DB (Studio at `http://127.0.0.1:54323` →
`agent_jobs`): the new row must have `operator_id` set to the dev operator's id
(`11111111-1111-4111-8111-111111111111`), not `null`.

## Running jobs end-to-end locally (optional)

Local enqueues land in the **local** DB, which the production Fly runner does **not** poll (by
design — no real campaigns from dev). To execute jobs locally, run the poller against the local DB:

```bash
# point the poller's env at the local Supabase, then:
bash scripts/poll-agent-jobs.sh
```

Keep the Meta MCP on a **sandbox / test ad account** (or a dry-run) so local runs never touch the
real Meta account.

## Troubleshooting

- **`/login` shows only "Senha"** → `AUTH_MODE` is missing or not `supabase` in `web/.env.local`.
  Restart `npm run dev` after fixing it (env is read at server start, not via HMR for some paths).
- **Email login fails** → the seeded auth user didn't take (gotrue version differences). Recreate it
  in Studio (`http://127.0.0.1:54323` → Authentication → Add user, email `bruno@b2tech.io`), then keep
  the same id in `supabase/seed.sql` for the operator/client rows.
- **Jobs stay `pending`** → either `operator_id` is null (see above) or no local poller is running
  (jobs only execute if something claims them).

## The lesson (don't let env drift)

The whole class of "operator_id null" bugs comes from env-var **structure** drift: a required key
(`AUTH_MODE`) existed in prod but not locally, invisibly. `AUTH_MODE` is now documented in
`.env.example`. Keep dev and prod key-sets in sync — diff `.env.example` against `vercel env ls`.
