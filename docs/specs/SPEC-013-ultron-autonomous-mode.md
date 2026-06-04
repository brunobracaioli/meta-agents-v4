# SPEC-013 — Modo autônomo do Ultron

| Campo | Valor |
|---|---|
| Status | Implementado — Fases 1+2+3 na `main` e deployadas (2026-06-04). Pendente: validação e2e por voz + `RESEND_API_KEY`. Fase 4 (genérico) futura. |
| Data | 2026-06-04 |
| Autor | brunobracaioli |
| ADR | [docs/adr/0019-ultron-autonomous-mode.md](../adr/0019-ultron-autonomous-mode.md) |
| Escopo v1 | `target_kind = landing_page` (genérico no schema) |
| Handoff | `NODES.md` (raiz) — estado vivo, paths, como testar, próximos passos |

## 1. Objetivo

Permitir que o operador, após enfileirar uma tarefa longa pelo Ultron (ex.: gerar uma landing
page), peça **"inicia o modo autônomo e monitora a execução"** e saia. O Ultron então, sem
intervenção humana: monitora o progresso, **narra por voz** atualizações periódicas, ao concluir
**abre a página, tira prints, analisa e opina por voz** seção a seção, **notifica por email** e
**encerra** o modo autônomo.

## 2. User flow (caso canônico)

1. Operador: *"Ultron, cria a landing page do produto `imersao-agencia`."* → Ultron enfileira
   (`agent_jobs`, ADR 0009).
2. Operador: *"Vou ter que sair. Inicia o modo autônomo e monitora toda a execução."*
3. Ultron chama `start_autonomous_mode(target_kind='landing_page', target_id=<lp>)` →
   cria `autonomous_watches` (phase=`watching`) ligada ao job e à `session_id` da aba. Fala:
   *"Modo autônomo ativado. Vou te narrando o progresso."*
4. A cada ~2–3 min, o tick narra marcos novos: *"Atualização: os agentes concluíram o scrape e
   a arquitetura, lançaram o subagente de copy long-form."*
5. Job conclui → `landing_pages.status=deployed`, URL disponível → phase=`reviewing`.
6. Ultron abre a URL (print server-side), fala opinião do topo, rola ~25%, novo print, nova
   opinião… até o rodapé.
7. phase=`notifying`: envia email para o destinatário do cliente; fala *"Criado com sucesso.
   Vou te notificar por email. Saindo do modo autônomo."* → phase=`done`.

## 3. Contratos

### 3.1 Schema (migrations)

`autonomous_watches` e `ultron_narrations` — colunas, índices e RLS conforme ADR 0019 §Decision
(itens 1 e 2). Ambas RLS on deny-by-default; acesso via service key.

RPC `claim_autonomous_watch(worker_id text) returns autonomous_watches` — `UPDATE … WHERE id =
(SELECT id FROM autonomous_watches WHERE phase in ('watching','reviewing','notifying') AND
updated_at < now() - interval '2 minutes' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *`. `SECURITY DEFINER`, `search_path=''`, EXECUTE revogado de public/anon/authenticated
(padrão ADR 0008).

### 3.2 Endpoints (web, server-side, service key)

> **Implementado (desvio do design):** `start`/`stop` NÃO viraram endpoints dedicados. As tools
> `start_autonomous_mode`/`stop_autonomous_mode` (`web/lib/ultron/tools.ts`) inserem/encerram o
> watch **direto via `db()`** (service key), resolvendo `client_id`/`agent_job_id` server-side a
> partir do job `kind='landing'` recente + `ctx.sessionId`. Só as narrações têm endpoints HTTP.
> O browser faz polling a ~5s (não 2s) e a narração é falada quando o status ∈ {idle, armed}.

- `start_autonomous_mode` (tool) — resolve o job de criação recente + `session_id` da aba, insere
  o watch. Idempotente pelo índice único `one_active_per_job` (trata 23505).
- `stop_autonomous_mode` (tool) — encerra watch(es) ativos da sessão (`phase=done`).
- `GET  /api/ultron/narrations?session=<id>` — narrações não faladas (≤1h, limit 10).
  200 `{ narrations: [{id,text,kind,image_path?,ts}] }`.
- `PATCH /api/ultron/narrations/:id` — marca `spoken_at` após o browser falar.

### 3.3 Skill `autonomous-watch-tick` (headless)

Input: `watch_id=<uuid>`. Lê o watch; ramifica por `phase` (`watching`→Passos 2–5, `reviewing`→
Passo R, `notifying`→Passo N; `done`/`failed`→no-op). Saídas: linhas em `ultron_narrations`,
transições de `phase`, `result` (URL + `review` + `notify_attempted`), email no Passo N.
Idempotente: reprocessar um tick não duplica narração nem reenvia email (cursores `last_event_ts`,
`last_narrated_milestone`, `result.review.next`, `result.notify_attempted`).

### 3.4 Scripts (implementados)

> **Nota:** `.cjs` (CommonJS), não `.mjs` — `require('playwright')`/módulos globais resolvem via
> `NODE_PATH`, que o ESM bare-specifier ignora. Ambos lêem credenciais do env do runner.

- `scripts/poll-autonomous-watches.sh` — cron `* * * * *`, claim (`claim_autonomous_watch`) +
  `AGENT_JOB_ID=<watch> run-skill.sh autonomous-watch-tick watch_id=<id>` (lock próprio).
- `scripts/screenshot-page.cjs --url <https> --watch <uuid> [--steps N]` — Playwright/Chromium;
  N prints por scroll; sobe ao bucket privado `ultron-review`; imprime
  `{ ok, shots: [{ storage_path, scroll_pct }], count }`. SSRF guard: só `https://*.b2tech.io`.
- `scripts/send-email.cjs --subject <s> --body-file <path> [--to] [--from]` — Resend. `RESEND_API_KEY`
  do env; destinatário/remetente default via env (`AUTONOMOUS_NOTIFY_EMAIL`/`AUTONOMOUS_FROM_EMAIL`),
  **nunca** de conteúdo da página. Imprime `{ ok, id }`. Degrada (`missing_resend_key`) sem a key.

## 4. Edge cases

- **Job falha** → watch `phase=failed`, narração *"a tarefa falhou em X; não vou seguir para a
  revisão"*, email opcional de falha, encerra.
- **Operador fecha a aba** (`session_id` sumiu) → narrações ficam não faladas; ao reabrir, o
  polling `since` busca as pendentes e fala o backlog (ou só a última, configurável).
- **`stop` no meio** → encerra sem revisão/email.
- **Sem URL ao concluir** (deploy pendente) → permanece em `watching` com backoff até a URL
  aparecer ou timeout (ex.: 30 min) → `failed`.
- **Watch órfão** (runner morre) → reaper marca `failed` (padrão ADR 0009).
- **Dois pedidos para o mesmo target** → índice único bloqueia o 2º; Ultron responde "já estou
  monitorando".
- **Screenshot falha** (página fora do ar) → narra o erro, pula revisão, ainda notifica.

## 5. Critérios de aceite

- [ ] `start_autonomous_mode` cria 1 watch e o Ultron fala a confirmação na aba correta.
- [ ] Durante a execução, ≥1 narração de status reflete marcos reais de `agent_events`
      (subagente lançado aparece na fala).
- [ ] A narração chega ao browser por polling e é falada via TTS (sem Realtime).
- [ ] Ao concluir, ≥2 prints da página são capturados **server-side** (sem screen share) e cada
      um gera uma fala de opinião.
- [ ] Email chega a `bruno@b2tech.io` com a URL.
- [ ] Watch encerra (`phase=done`) e o Ultron fala "saindo do modo autônomo".
- [ ] Reexecutar um tick não duplica narração (idempotência).
- [ ] Nenhum segredo no diff; `RESEND_API_KEY` só em env; SSRF mitigado (URL restrita ao
      domínio do cliente).

## 6. Fases de entrega

- **Fase 1 — Fundação (sem voz/visão):** migrations (`autonomous_watches`, `ultron_narrations`,
  `claim_autonomous_watch`), endpoints start/stop/narrations, tools no Ultron, e o
  `poll-autonomous-watches.sh` + skill `autonomous-watch-tick` **só na fase `watching`**
  (narração de status). Critério: operador inicia, recebe narrações de status faladas, encerra.
  Verificar a correlação `agent_job ↔ run_id ↔ agent_events`.
- **Fase 2 — Revisão visual server-side ✅ (2026-06-04):** `scripts/screenshot-page.cjs`
  (Playwright/Chromium na imagem Fly, SSRF guard `*.b2tech.io`), bucket privado `ultron-review`,
  fase `reviewing` na skill (captura 1× → opinião 1/tick com visão). `watching → reviewing →
  done`. Critério: prints + opiniões sem screen share. (Nota de escopo: o `image_path` é
  persistido para auditoria; a aba FALA a opinião, mas ainda não RENDERIZA o print — opcional,
  fora do critério.)
- **Fase 3 — Email + encerramento ✅ (2026-06-04):** Resend (`scripts/send-email.cjs`), fase
  `notifying` na skill (Passo N: email ao operador + fala "saindo do modo autônomo"), `done`.
  Destinatário/remetente fixos via env/default (`AUTONOMOUS_NOTIFY_EMAIL`/`AUTONOMOUS_FROM_EMAIL`),
  nunca derivados de conteúdo da página. Idempotente (`result.notify_attempted`). Fail-safe: sem
  `RESEND_API_KEY` o Passo N degrada (narra + encerra, sem travar). Critério: email entregue +
  watch `done`. **Requer `RESEND_API_KEY` no Fly + domínio verificado no Resend.**
- **Fase 4 (futuro) — Genérico:** plugar `target_kind=campaign|analysis` reusando o schema.

## 7. Fora de escopo (v1)

- Observar múltiplos targets simultâneos por sessão (1 watch ativo por target já basta).
- Fallback de email (só Resend).
- Verificação adversarial multi-agente da página (Workflow) — evolução futura.
