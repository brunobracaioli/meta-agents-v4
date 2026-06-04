# NODES — Feature "Modo autônomo do Ultron" (handoff pós-/compact)

> **Leia este arquivo PRIMEIRO** se a conversa foi compactada. Captura o que foi
> descoberto/decidido/feito nesta rodada. Fontes de verdade complementares:
> - ADR: `docs/adr/0019-ultron-autonomous-mode.md`
> - Spec: `docs/specs/SPEC-013-ultron-autonomous-mode.md`
> - Memória de projeto: `ultron-autonomous-mode.md` (carrega sozinha a cada sessão)
> - Branches: `feat/ultron-autonomous-mode` (Fase 1), `…-phase2` (Fase 2), `…-phase3` (Fase 3) —
>   **as três mergeadas na `main` e deletadas** (2026-06-04). Próxima: Fase 4 (genérico).
> - (NOTES.md = handoff de OUTRA feature, o editor de LP. Não confundir.)

---

## 0. TL;DR de estado

- **FASES 1 + 2 + 3 = COMPLETAS e MERGEADAS na `main`** (2026-06-04). Fluxo completo do modo
  autônomo: `watching → reviewing → notifying → done`.
- **Deployado e validado AO VIVO** no runner `meta-agents-v4`: Fase 2 (screenshot real de
  cca-e2e.b2tech.io → 4 JPEGs no bucket privado) e Fase 3 (`send-email.cjs` presente + degrada
  gracioso sem key). Gates: `node --check` dos `.cjs`, guardas SSRF/uuid/email validadas.
- **Migrations APLICADAS em prod**: `20260604000001_add_autonomous_mode` (tabelas + RPC) e
  `20260604000002_add_ultron_review_bucket` (bucket privado `ultron-review`).
- **Fase 3 entregue**: `scripts/send-email.cjs` (Resend), fase `notifying` na skill (Passo N: email
  + fala "saindo do modo autônomo"). Destinatário/remetente fixos via env/default
  (`bruno@b2tech.io` / `Ultron <ultron@b2tech.io>`), nunca de conteúdo da página. Idempotente
  (`result.notify_attempted`). Fail-safe sem a key.
- **⚠️ Falta 1 passo p/ email real**: setar `RESEND_API_KEY` no Fly (`fly secrets set
  RESEND_API_KEY=re_... -a meta-agents-v4`) + verificar domínio `b2tech.io` no Resend. Sem isso, o
  modo autônomo funciona inteiro, só não envia email (narra o fallback). Operador (Bruno) vai rodar.
- **Fase 4 = NÃO feita** (genérico campanha/análise; schema já preparado).
- **Falta validar**: teste e2e real com voz (criar LP pelo Ultron → "modo autônomo" → ouvir status →
  opiniões da revisão → email + "saindo do modo autônomo").

## 1. O que o usuário quer (pedido original)

Operador pede pra criar uma landing page → Ultron ativa os agentes. Operador diz "vou ter que sair,
inicia o modo autônomo e monitora a execução". Ultron então, sozinho:
1. monitora a execução e **narra o progresso por voz** a cada X (~2 min): "iniciaram X, concluíram Y,
   lançaram o subagente Z";
2. ao concluir, recebe a URL, **abre a página no navegador, tira print, analisa/opina por voz**,
   scrolla X%, repete até o fim;
3. **notifica bruno@b2tech.io por e-mail** que foi criado;
4. diz **"saindo do modo autônomo"** e encerra.

Plano de 4 fases acordado → **(1)** narração ✅ · **(2)** revisão visual ✅ · **(3)** e-mail+fala final ✅ ·
**(4)** genérico (campanha/análise) ❌ (futuro). **Fases 1, 2 e 3 entregues, deployadas e na `main`.**
O escopo v1 confirmado pelo operador: `target_kind=landing_page`, schema já genérico p/ a Fase 4.

## 2. Arquitetura (modelo mental — NÃO re-derivar)

O Ultron headless (skill `claude -p` no runner Fly) é um **processo separado** da aba do operador
(Vercel, onde vivem voz/visão). Tudo cola via **Postgres + polling** (reusa ADR 0007/0009, **sem
Realtime, sem webhook inbound** — ADR 0001):

```
Operador: "inicia o modo autônomo"
  └─ tool start_autonomous_mode(ctx.sessionId) → cria linha em autonomous_watches (Postgres)
                                                  (liga agent_job + session da aba)
supercronic */1min: poll-autonomous-watches.sh  → claima 1 watch DUE (cadência ~90s, lock próprio)
  └─ run-skill.sh autonomous-watch-tick watch_id=<id>   (LLM, ramifica por phase)
       ├─ watching:  lê agent_job + agent_events (run_id = agent_job.id) → UMA fala → ultron_narrations
       ├─ reviewing: screenshot-page.cjs (Playwright) → Read do print → opinião 1/tick (kind=opinion)
       ├─ notifying: send-email.cjs (Resend) → fala "saindo do modo autônomo"
       └─ avança cursores / phase: watching → reviewing → notifying → done
Browser do Ultron: GET /api/ultron/narrations?session= (~5s) → fala via TTS → PATCH spoken_at
```

## 3. Decisões importantes (já tomadas)

- **Polling, não Realtime** pra narração — mantém RLS deny-by-default (coerência ADR 0007).
- **REST/curl na skill, não MCP do Supabase** — o MCP é OAuth-gated em headless (memória
  `claude-headless-runner-gotchas`). A skill usa `SUPABASE_URL`/`SUPABASE_SECRET_KEY` + curl.
- **Captura da revisão (Fase 2) = screenshot server-side (Playwright no Fly)**, decidido pelo
  usuário — independe da tela do operador (que estará ausente). NÃO usar `getDisplayMedia`.
- **E-mail (Fase 3) = Resend** (Gmail MCP é OAuth-gated headless). `RESEND_API_KEY` ainda NÃO está
  setada (nem no `.env.local` nem no Fly em 2026-06-04) → o Passo N degrada gracioso até o operador
  setar. Destinatário/remetente NUNCA derivados de conteúdo da página (anti-spam).
- **start/stop_autonomous_mode SEM 2 passos** (risco baixo, sem gasto) — diferente de criar/ativar.
- **Watch observa o job de CRIAÇÃO** (`kind='landing'`); a skill segue sozinha até o job
  `landing_publish` e a URL deployada. `target_id` (landing_pages.id) começa null e é resolvido
  pelo subdomínio (`args.nome`) quando a linha existe.

## 4. A correção-chave desta rodada: correlação `run_id`

**Descoberta:** as linhas de `agent_events` por-tool usavam `run_id = session_id interno do Claude`
(do stream-json), **não** o `agent_job.id` — não havia link job→eventos. Sem isso, o watch não
consegue dizer "lançou o subagente Z".

**Fix (`scripts/emit-from-stream.py`):** quando `AGENT_JOB_ID` está no ambiente (o poller de jobs já
exporta), carimba `row["run_id"] = AGENT_JOB_ID`. Assim `agent_events.run_id == agent_jobs.id`.
Retrocompatível (cron sem job mantém run_id = session). **Só vale após redeploy do Fly.**

## 5. O que foi construído (paths exatos)

**Banco** — `supabase/migrations/20260604000001_add_autonomous_mode.sql` (aplicada em prod):
- `autonomous_watches`: id, client_id, target_kind('landing_page'), target_id, target_hint,
  agent_job_id, publish_job_id, session_id, phase(watching|reviewing|notifying|done|failed),
  last_event_ts, last_narrated_milestone, result jsonb, started_by, timestamps, closed_at.
  Índice único parcial `one_active_per_job` (dedup por agent_job_id em fase ativa). Trigger
  set_updated_at. RLS on deny-by-default.
- `ultron_narrations`: id, watch_id(fk cascade), session_id, ts, text, kind(status|opinion|system),
  image_path (Fase 2), spoken_at, created_at. Índice (session_id, ts). RLS on.
- RPC `claim_autonomous_watch(worker_id)`: claima 1 watch ativo com `updated_at < now()-90s`,
  bumpa updated_at (cadência), FOR UPDATE SKIP LOCKED, SECURITY DEFINER, EXECUTE revogado.
- Tipos regenerados em `web/lib/db/types.ts`.

**Runner** (no image Fly — exige redeploy):
- `scripts/poll-autonomous-watches.sh` — espelha poll-agent-jobs.sh, lock `/tmp/autonomous-watch-poll.lock`.
- `crontab` — nova linha `* * * * * /app/scripts/poll-autonomous-watches.sh`.
- `.claude/skills/autonomous-watch-tick/SKILL.md` — a skill do tick (Passos 2–5 `watching`,
  Passo R `reviewing`, Passo N `notifying`).
- `scripts/emit-from-stream.py` — correlação run_id (ver §4).
- **(Fase 2)** `scripts/screenshot-page.cjs` — screenshotter Playwright (SSRF guard `*.b2tech.io`,
  upload ao bucket `ultron-review`, JSON manifest). Invocado pela skill no ramo `reviewing`.
- **(Fase 2)** `Dockerfile` — Playwright + Chromium (root, `--with-deps`, `/ms-playwright` world-
  readable) + `NODE_PATH`/`PLAYWRIGHT_BROWSERS_PATH`. `fly.toml` — memória 2GB.
- **(Fase 3)** `scripts/send-email.cjs` — email via Resend (`RESEND_API_KEY` do env; to/from fixos
  via env/default, NÃO de conteúdo da página; corpo via `--body-file`). Invocado no Passo N. É
  `.cjs` pelo mesmo motivo do screenshotter (NODE_PATH p/ require). `.env.example` documenta a env.

**Web** (deploy automático no push):
- `web/lib/ultron/tools.ts` — tools `start_autonomous_mode`/`stop_autonomous_mode`; `ToolContext`;
  `runTool(name, input, ctx)` (ctx default `{sessionId:""}` p/ não quebrar testes).
- `web/lib/ultron/chat.ts` — passa `{sessionId: ctx.sessionId}` ao runTool.
- `web/lib/ultron/prompt.ts` — seção "MODO AUTÔNOMO".
- `web/lib/services/narrations.ts` — getPendingNarrations / markNarrationSpoken.
- `web/app/api/[[...route]]/route.ts` — `GET /ultron/narrations`, `PATCH /ultron/narrations/:id`.
- `web/components/ultron/use-ultron-voice.ts` — poller (5s) que fala narração via `speak()` quando
  status ∈ {idle, armed}; dedup por id; marca spoken.
- Testes: `web/lib/ultron/autonomous-mode.test.ts` (6) + ajuste em `chat.test.ts` (ctx no runTool).

**Docs**: `docs/adr/0019-...`, `docs/specs/SPEC-013-...`.

## 6. Fatos do codebase descobertos (evita re-explorar)

- `agent_jobs` é a fila (ADR 0009); `poll-agent-jobs.sh` exporta `AGENT_JOB_ID` ao rodar a skill.
- `agent_events` é a telemetria; populada por `emit-from-stream.py` (parsing stream-json, pois hooks
  NÃO disparam em `claude -p` headless — issue #40506). `run-skill.sh` pula lifecycle se AGENT_JOB_ID setado.
- A criação de LP é DOIS jobs: `kind='landing'` (create-landing-page cria o rascunho + enfileira) →
  `kind='landing_publish'` (build+deploy Cloudflare → landing_pages.status deployed + url).
- `db()` é tipado contra `Database` gerado → **regenerar tipos após cada migration** (header manda).
- Sessão da aba = `getSessionId()` (sessionStorage uuid) → vai no `/api/ultron/chat` como `sessionId`.
- `speak()` (use-ultron-voice) restaura o modo (idle/armed/handsfree) ao terminar — reusável.
- **ESLint NÃO está configurado no repo** (`next lint` pede setup interativo) — gate real é tsc+vitest.

## 7. Como testar (e2e, fases 1+2+3) — runner já deployado

**Pré p/ email real (Fase 3):** `fly secrets set RESEND_API_KEY=re_... -a meta-agents-v4` + domínio
`b2tech.io` verificado no Resend. Sem isso, tudo funciona menos o envio (Ultron narra o fallback).

1. No dashboard, peça ao Ultron: criar landing page (request_landing_page_creation, dois passos).
2. Diga "inicia o modo autônomo e monitora". Ultron deve falar a confirmação (`start_autonomous_mode`).
3. **watching** (~90s–2min/tick): chegam narrações faladas de progresso (refletindo agent_events reais).
4. **reviewing**: quando a LP fica no ar, Ultron fala a URL e depois **opina seção a seção** (uma
   opinião por tick, lendo os prints do bucket `ultron-review`).
5. **notifying**: Ultron envia o email, fala "saindo do modo autônomo" e o watch vai a `phase=done`.
- SQL de inspeção:
  - `select phase,last_narrated_milestone,result from autonomous_watches order by created_at desc limit 5;`
  - `select ts,text,kind,image_path,spoken_at from ultron_narrations order by ts desc limit 15;`
  - prints da revisão: `select name from storage.objects where bucket_id='ultron-review' order by created_at desc;`
- **Smoke isolado do email** (sem e2e), via SSH no runner (precisa da key setada):
  `fly ssh console -a meta-agents-v4 -C "su runner -m -c 'printf teste > /tmp/b.txt && node /app/scripts/send-email.cjs --subject \"smoke\" --body-file /tmp/b.txt'"`
- **Smoke isolado do screenshot** (já validado 2026-06-04): mesmo padrão chamando
  `screenshot-page.cjs --url https://<lp>.b2tech.io --watch <uuid>` → JSON com 4 shots.

## 8. Próximos passos — onde plugar

- **Fase 2 (revisão visual) ✅ FEITA.** `scripts/screenshot-page.cjs` (Playwright, captura por
  scroll, upload ao bucket privado `ultron-review`, manifest JSON, SSRF guard) + ramo `reviewing`
  na skill (R.1 captura 1× → R.2 opinião 1/tick com `Read` da imagem → R.3 encerra). Transição
  `watching → reviewing → done`. **`.cjs` (não `.mjs`)** de propósito: `require('playwright')`
  global resolve via `NODE_PATH` (ESM bare-specifier ignoraria `NODE_PATH`). Memória 2GB.
- **Fase 3 (e-mail) ✅ FEITA.** `scripts/send-email.cjs` (Resend) + Passo N (`notifying`) na skill.
  R.3 e os caminhos de falha/timeout da revisão agora vão p/ `notifying` (a página está no ar →
  ainda notifica), nunca travam. Email só do **Fly** (a skill envia; Vercel não precisa). Falta só
  o secret `RESEND_API_KEY` no Fly + domínio verificado no Resend. Destinatário via
  `AUTONOMOUS_NOTIFY_EMAIL` (default `bruno@b2tech.io`), remetente via `AUTONOMOUS_FROM_EMAIL`
  (default `Ultron <ultron@b2tech.io>`).
- **Fase 4 — PRÓXIMA (futuro)**: `target_kind` já genérico no schema → plugar campanha/análise.
  Onde plugar: a tool `start_autonomous_mode` (web/lib/ultron/tools.ts) hoje só resolve job
  `kind='landing'`; generalizar p/ campanha/análise + ramos na skill por `target_kind`.

## 9. Ações consequentes — FEITAS (2026-06-04)

- ✅ **Fase 1**: merge `--no-ff` na `main` + push; `fly deploy` (versão 20); migration
  `add_autonomous_mode` aplicada + smoke SQL ok. Verificado por SSH.
- ✅ **Fase 2**: merge `--no-ff` na `main` + push; migration `add_ultron_review_bucket` aplicada;
  `fly deploy` (imagem 502→860MB com Chromium, VM 2GB). **Smoke real ao vivo**: screenshot de
  `cca-e2e.b2tech.io` → 4 JPEGs no bucket privado (confirmados em storage.objects, depois limpos).
- ✅ **Fase 3**: merge `--no-ff` na `main` + push; `fly deploy` (script + skill na imagem).
  Verificado por SSH: `send-email.cjs` presente + degrade gracioso sem key (`missing_resend_key`).
- **PENDENTE (operador)**: `fly secrets set RESEND_API_KEY` + domínio no Resend; depois o teste
  e2e real com voz pelo dashboard. **Fase 4** (genérico) ainda não iniciada.

## 10. Estado git

- 3 branches mergeadas na `main` (merge `--no-ff`) e **deletadas**, pushadas (origin =
  github.com/brunobracaioli/meta-agents-v4), todas 2026-06-04:
  `feat/ultron-autonomous-mode` (F1), `feat/ultron-autonomous-mode-phase2` (F2),
  `feat/ultron-autonomous-mode-phase3` (F3). HEAD da `main` após F3: `325ad24`.
- ⚠️ Mudanças NÃO-relacionadas no working tree (imersao-agencia.json, create-landing-page SKILL.md,
  packages/lp-render globals.css + Hero.tsx, PNGs soltos, hero/ e *-preview.html, tentativas-…json)
  — **deixadas intactas e não commitadas** de propósito em todas as rodadas.
