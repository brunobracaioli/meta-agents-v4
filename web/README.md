# Web Dashboard + Ultron

Frontend operacional (Next.js 15, App Router) + backend (Hono em route handlers) na Vercel.
Lê o que os agents persistem no Supabase. Assistente de voz "Ultron" (fases 2+).

Specs: [`docs/specs/web-dashboard-ultron.md`](../docs/specs/web-dashboard-ultron.md) ·
[`docs/specs/ultron-voice-pipeline.md`](../docs/specs/ultron-voice-pipeline.md).
ADRs 0005–0007. Contrato: [`docs/api/openapi.yaml`](../docs/api/openapi.yaml).

## Dev

```bash
cd web
npm install
npm run dev      # http://localhost:3000  (carrega os secrets de ../.env.local)
npm run build    # build de produção
npm run typecheck
```

Env: o `next.config.ts` carrega `../.env.local` (raiz = casa dos secrets). Variáveis novas
do dashboard estão documentadas em `../.env.example` (`DASHBOARD_PASSWORD`, `AUTH_SECRET`,
`ELEVENLABS_*`, `PICOVOICE_ACCESS_KEY`). O Anthropic SDK usa `CLAUDE_API_KEY` como fallback
de `ANTHROPIC_API_KEY`.

## Arquitetura

- `lib/db/` — client Supabase **server-only** (secret key, bypassa RLS) + tipos gerados.
- `lib/auth/` — senha (SHA-256) → cookie JWT (jose). `middleware.ts` protege rotas + headers.
- `lib/services/` — query → DTO (componentes nunca tocam o DB direto).
- `lib/ultron/` — tools read-only, memória (Redis), prompt (fase 2).
- `app/api/[[...route]]/route.ts` — Hono: `auth/*`, `ultron/*` (fase 2), `dashboard/*`.

## Deploy (Vercel)

Projeto com **Root Directory = `web`**, region `gru1` (`vercel.json`). Configurar no painel
da Vercel todas as envs de `../.env.example` (secrets server-side; nunca no client).

## Notas de implementação

- Leitura via `supabase-js` (PostgREST) em vez de conexão Drizzle direta, porque o
  `.env.local` não traz `DATABASE_URL`/connection string. Tipagem garantida pelos tipos
  gerados do schema. Migrar para Drizzle é trivial se um `DATABASE_URL` for provisionado.
- Rate limit (Upstash) **fail-open**: se o Redis cair, o endpoint não quebra (loga o miss).
