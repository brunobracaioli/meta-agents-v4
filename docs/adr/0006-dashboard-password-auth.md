# ADR 0006 — Autenticação do dashboard por senha única + cookie JWT

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-30 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/web-dashboard-ultron.md](../specs/web-dashboard-ultron.md) |

## Context

O dashboard é de **operador único** nesta fase. O `.env.local` já traz
`DASHBOARD_PASSWORD` (hash hex, aparenta SHA-256). O CLAUDE.md cita Supabase Auth
(magic-link) na stack, porém isso exige e-mail, sessão Supabase e policies RLS por
usuário — overhead desnecessário para um operador só agora.

## Decision

Gate por **senha única** comparada contra `DASHBOARD_PASSWORD`, emitindo um **cookie JWT**
httpOnly/Secure/SameSite=Lax assinado com `AUTH_SECRET` (novo segredo).

- `POST /api/auth/login`: valida a senha (comparação do hash; confirmar algoritmo do hash
  no `.env.local` — SHA-256 hex). Em sucesso, set-cookie JWT curto (ex.: 7d).
- `middleware.ts` protege `/dashboard/*` e `/api/*` (exceto `/api/auth/login`) e aplica
  security headers.
- **Rate limit** (Upstash) no login para mitigar brute-force; resposta 401 genérica.
- Acesso ao Supabase é sempre **server-side** com service key; o browser nunca recebe
  segredo. RLS do banco segue deny-by-default (não dependemos de policy por usuário).

## Consequences

**Prós:** simples, sem dependência de e-mail, suficiente para 1 operador; segredos ficam
no server. **Contras:** sem identidade individual nem multi-usuário; rotação de senha é
manual (trocar o hash). **Evolução futura:** migrar para Supabase Auth (magic-link) +
RLS por usuário quando houver mais operadores — trocar o middleware e a origem da sessão,
mantendo os handlers. **Segurança:** SHA-256 simples é fraco para senha; como é segredo
único de operador (não base de usuários), é aceitável agora — considerar Argon2id na
evolução multi-usuário.
