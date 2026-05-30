# Repository Guidelines

## Project Structure & Module Organization

This repository contains an AI-operated Meta Ads agency runner plus an operational web dashboard. The Next.js app lives in `web/`; use `web/app/` for App Router pages and route handlers, `web/components/` for React UI, and `web/lib/` for server-only services, auth, database access, and Ultron voice logic. Supabase schema changes are in `supabase/migrations/` and should be timestamped SQL files. Product specs, ADRs, API contracts, runbooks, and threat models are under `docs/`. Fly.io runner files are at the root (`Dockerfile`, `fly.toml`, `crontab`) with helper scripts in `scripts/`. Generated campaign attempts are stored in `tentativas-geracao-de-campanhas/`.

## Build, Test, and Development Commands

Run web commands from the repo root with `--prefix web`:

- `npm install --prefix web` installs dashboard dependencies.
- `npm run dev --prefix web` starts Next.js locally at `http://localhost:3000`.
- `npm run build --prefix web` creates the production build.
- `npm run typecheck --prefix web` runs TypeScript checks.
- `npm run lint --prefix web` runs the configured Next.js lint command.
- `npm test --prefix web` runs Vitest tests.

Use `scripts/healthz.sh` to probe the deployed runner health endpoint when operating Fly.io deployments.

## Coding Style & Naming Conventions

Use TypeScript, ES modules, two-space indentation, double quotes, and semicolons, matching the existing `web` code. Keep React route components in lowercase route folders and name reusable components with kebab-case filenames, for example `components/logout-button.tsx`. Server-only integrations belong in `web/lib/`; do not import secret-bearing modules into Client Components. Prefer small service functions that return DTOs rather than querying Supabase directly from UI components.

## Testing Guidelines

Vitest is the test runner. Add focused tests near the code they cover using `*.test.ts` or `*.test.tsx`. Prioritize tests for auth/session behavior, API route validation, rate limiting, data formatting, and Supabase service mapping. Run `npm test --prefix web` plus `npm run typecheck --prefix web` before opening a PR.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `feat(web): ...`, `fix(web): ...`, and `docs: ...`. Keep commits scoped and imperative. PRs should include a short summary, linked issue or context, verification commands run, migration notes for `supabase/migrations/`, and screenshots or recordings for dashboard UI changes.

## Security & Configuration Tips

Never commit `.env.local` or production secrets. Start from `.env.example`; `web/next.config.ts` loads root-level secrets for local development. Keep Supabase secret-key usage server-only, preserve middleware protections on dashboard routes, and update `docs/security/threats/` when changing authentication, storage, or public API exposure.
