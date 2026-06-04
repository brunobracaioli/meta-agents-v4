# NODES — Feature "Modo autônomo do Ultron" (handoff pós-/compact)

> **Leia este arquivo PRIMEIRO** se a conversa foi compactada. Captura o que foi
> descoberto/decidido/feito nesta rodada. Fontes de verdade complementares:
> - ADR: `docs/adr/0019-ultron-autonomous-mode.md`
> - Spec: `docs/specs/SPEC-013-ultron-autonomous-mode.md`
> - Memória de projeto: `ultron-autonomous-mode.md` (carrega sozinha a cada sessão)
> - Branch: **`feat/ultron-autonomous-mode`** → **mergeada na `main`** (2026-06-04)
> - (NOTES.md = handoff de OUTRA feature, o editor de LP. Não confundir.)

---

## 0. TL;DR de estado

- **FASE 1 = COMPLETA, testada e MERGEADA na `main` (2026-06-04).**
- Gates verdes: `tsc --strict` limpo no `web/` inteiro; **38 testes vitest** passando
  (6 novos em `web/lib/ultron/autonomous-mode.test.ts`); `bash -n` + `py_compile` ok;
  **smoke test SQL em prod** (claim + cadência + narração + cleanup) ok.
- **Migration APLICADA em prod** (`20260604000001_add_autonomous_mode`) via Supabase MCP:
  `autonomous_watches`, `ultron_narrations`, RPC `claim_autonomous_watch`. Tipos regenerados.
- **Fases 2, 3, 4 = NÃO feitas** (revisão visual / e-mail / genérico). Schema já preparado pra elas.
- ⚠️ **Web sobe sozinho no push pra `main` (Vercel).** O **runner Fly NÃO** — precisa de
  `fly deploy` pra pegar o poller novo + crontab + skill + `emit-from-stream.py`. **Até o redeploy
  do Fly, o modo autônomo NÃO funciona end-to-end** (a tool liga o watch, mas nada faz o tick).

## 1. O que o usuário quer (pedido original)

Operador pede pra criar uma landing page → Ultron ativa os agentes. Operador diz "vou ter que sair,
inicia o modo autônomo e monitora a execução". Ultron então, sozinho:
1. monitora a execução e **narra o progresso por voz** a cada X (~2 min): "iniciaram X, concluíram Y,
   lançaram o subagente Z";
2. ao concluir, recebe a URL, **abre a página no navegador, tira print, analisa/opina por voz**,
   scrolla X%, repete até o fim;
3. **notifica bruno@b2tech.io por e-mail** que foi criado;
4. diz **"saindo do modo autônomo"** e encerra.

Plano de 4 fases acordado → **(1)** narração ✅ · **(2)** revisão visual ❌ · **(3)** e-mail+fala final ❌ ·
**(4)** genérico (campanha/análise) ❌. **Só a Fase 1 foi pedida/entregue nesta rodada.**

## 2. Arquitetura (modelo mental — NÃO re-derivar)

O Ultron headless (skill `claude -p` no runner Fly) é um **processo separado** da aba do operador
(Vercel, onde vivem voz/visão). Tudo cola via **Postgres + polling** (reusa ADR 0007/0009, **sem
Realtime, sem webhook inbound** — ADR 0001):

```
Operador: "inicia o modo autônomo"
  └─ tool start_autonomous_mode(ctx.sessionId) → cria linha em autonomous_watches (Postgres)
                                                  (liga agent_job + session da aba)
supercronic */1min: poll-autonomous-watches.sh  → claima 1 watch DUE (cadência ~90s, lock próprio)
  └─ run-skill.sh autonomous-watch-tick watch_id=<id>   (LLM, fase `watching`)
       ├─ lê agent_job + agent_events (run_id = agent_job.id)
       ├─ compõe UMA fala natural pt-BR → INSERT em ultron_narrations
       └─ avança cursores / fase (watching → done quando a LP fica no ar)
Browser do Ultron: GET /api/ultron/narrations?session= (~5s) → fala via TTS → PATCH spoken_at
```

## 3. Decisões importantes (já tomadas)

- **Polling, não Realtime** pra narração — mantém RLS deny-by-default (coerência ADR 0007).
- **REST/curl na skill, não MCP do Supabase** — o MCP é OAuth-gated em headless (memória
  `claude-headless-runner-gotchas`). A skill usa `SUPABASE_URL`/`SUPABASE_SECRET_KEY` + curl.
- **Captura da revisão (Fase 2) = screenshot server-side (Playwright no Fly)**, decidido pelo
  usuário — independe da tela do operador (que estará ausente). NÃO usar `getDisplayMedia`.
- **E-mail (Fase 3) = Resend** (Gmail MCP é OAuth-gated headless). `RESEND_API_KEY` ainda NÃO existe.
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
- `.claude/skills/autonomous-watch-tick/SKILL.md` — a skill do tick (só fase `watching`).
- `scripts/emit-from-stream.py` — correlação run_id (ver §4).

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

## 7. Como testar (Fase 1) — DEPOIS do redeploy do Fly

1. No dashboard, peça ao Ultron: criar landing page (request_landing_page_creation, dois passos).
2. Diga "inicia o modo autônomo e monitora". Ultron deve falar a confirmação.
3. Em ~90s–2min, devem chegar narrações faladas de progresso (refletindo agent_events reais).
4. Ao publicar, Ultron fala a URL e o watch vai a `phase=done`.
- SQL de inspeção: `select phase,last_narrated_milestone,result from autonomous_watches order by created_at desc limit 5;`
  e `select ts,text,kind,spoken_at from ultron_narrations order by ts desc limit 10;`

## 8. Próximos passos (Fases 2–3) — onde plugar

- **Fase 2 (revisão visual)**: `scripts/screenshot-page.mjs` (Playwright no image Fly — aumenta o
  container) + ramo `reviewing` na skill (print → opinião por seção, kind `opinion`, image_path no
  bucket privado). Transição: em vez de `watching → done`, vira `watching → reviewing → ...`.
- **Fase 3 (e-mail)**: `scripts/send-email.mjs` (Resend, `RESEND_API_KEY` a criar no Fly+Vercel) +
  ramo `notifying` + fala final "saindo do modo autônomo".
- **Fase 4**: `target_kind` já genérico no schema → plugar campanha/análise.

## 9. Ações consequentes pendentes (precisam de OK / ação externa)

- **`fly deploy`** do runner `meta-agents-v4` (machine 286501db9e7e78) — necessário pra Fase 1
  funcionar de verdade. Ainda NÃO executado nesta rodada.
- Sem isso, a Fase 1 está só "mergeada", não "ao vivo".

## 10. Estado git

- Branch `feat/ultron-autonomous-mode` mergeada na `main` (merge --no-ff) e pushada (origin =
  github.com/brunobracaioli/meta-agents-v4) em 2026-06-04.
- ⚠️ Havia mudanças NÃO-relacionadas no working tree (imersao-agencia.json, Hero.tsx, globals.css,
  create-landing-page SKILL.md, PNGs soltos) — **deixadas intactas e não commitadas** de propósito.
