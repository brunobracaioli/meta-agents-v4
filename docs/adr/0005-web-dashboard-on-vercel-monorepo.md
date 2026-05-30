# ADR 0005 — Web dashboard na Vercel como subpasta `web/` do mesmo repo

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-30 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/web-dashboard-ultron.md](../specs/web-dashboard-ultron.md) |

## Context

O projeto era só um runner headless (Fly.io + supercronic) que cria/analisa campanhas
Meta Ads e persiste no Supabase. Não havia interface. Precisamos de um frontend +
backend (Next.js) na Vercel para o dashboard e o assistente de voz "Ultron". Os agents
continuam na Fly.io. Questão: onde hospedar o código novo — mesmo repo ou repo separado.

## Decision

Criar o app Next.js 15 (App Router, React 19, TS strict, Tailwind 4, shadcn/ui, Hono em
route handlers) numa **subpasta `web/`** deste mesmo repositório. Na Vercel, o projeto
usa **Root Directory = `web`** e region `gru1`. O runner Fly.io continua usando a raiz
(`Dockerfile`, `fly.toml`, `crontab`, `.claude/`).

- Leitura do Supabase via Drizzle no server (`SUPABASE_SECRET_KEY`), nunca no client.
- `supabase-js` só para Realtime (fase 4), com `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Specs/ADRs/OpenAPI seguem em `docs/` na raiz (fonte única).

## Consequences

**Prós:** uma fonte de verdade (specs + skills + app juntos); compartilha `docs/` e o
conhecimento do schema; um histórico git; deploy independente via Root Directory.
**Contras:** raiz mista (runner + app web) exige `.gitignore`/`.vercelignore` cuidadosos
(`web/node_modules`, `web/.next`); o build da Vercel ignora a raiz. Aceitável.
**Alternativa descartada:** repo separado — isolaria deploy/deps mas duplicaria env, tipos
do schema e afastaria specs da implementação dos agents.
