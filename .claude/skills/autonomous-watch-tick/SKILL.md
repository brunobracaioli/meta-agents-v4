---
name: autonomous-watch-tick
description: Executa UM tick do "modo autônomo" do Ultron sobre um autonomous_watches (ADR 0019 / SPEC-013). Lê o agent_job observado + seus agent_events, compõe UMA narração natural de progresso em pt-BR e insere em ultron_narrations (que a aba do operador faz polling e fala por TTS), e avança a fase do watch. Disparada SOMENTE pela fila autonomous_watches via scripts/poll-autonomous-watches.sh (`claude -p --dangerously-skip-permissions ".claude/skills/autonomous-watch-tick watch_id=<uuid>"`). É headless, idempotente e fail-safe. FASE 1 = só a fase `watching` (narração de status até a página ficar no ar); revisão visual e email são Fases 2/3. NÃO cria/edita campanha nem landing page — só observa e narra.
---

# Skill: /autonomous-watch-tick

Um **tick** do modo autônomo: o Ultron, enquanto o operador está fora, observa uma tarefa longa
(hoje: geração de landing page) e **narra o progresso por voz**. Como o Ultron headless (este
processo, no runner Fly) é separado da aba do operador (Vercel), a narração viaja pelo Postgres:
você **insere uma linha em `ultron_narrations`**; o browser faz polling e fala via TTS.

> ADR: docs/adr/0019-ultron-autonomous-mode.md · Spec: docs/specs/SPEC-013-ultron-autonomous-mode.md
> Padrões reusados: fila no Postgres + polling (ADR 0009/0007), correlação `agent_events.run_id =
> agent_job.id` (instrumentada em scripts/emit-from-stream.py).

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

- **Headless**: NUNCA pergunte nada. Decida e execute. Um tick = no máximo UMA narração.
- **Idempotente**: reprocessar o mesmo estado NÃO repete fala. Use os cursores do watch
  (`last_event_ts`, `last_narrated_milestone`). Se nada mudou desde o último tick, **não narre**.
- **Fail-safe**: erro de rede/JSON → saia 0 sem quebrar; o watch é re-tickado na próxima cadência.
- **Persistência via REST/curl** (PostgREST), NÃO via MCP do Supabase (que é OAuth-gated em
  headless). Use as credenciais do ambiente do runner.
- **Escopo Fase 1**: implemente só a fase `watching`. Se o watch já estiver em `reviewing`,
  `notifying`, `done` ou `failed`, não faça nada (saia 0) — essas fases são das Fases 2/3.

## 2. Setup (ambiente)

```bash
WATCH_ID="<recebido em watch_id=...>"   # valide: uuid (36 chars hex/hífen). Se inválido, saia 0.
BASE="$(printf '%s' "${SUPABASE_URL}" | tr -d '[:space:]')"
KEY="$(printf '%s' "${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY}}" | tr -d '[:space:]')"
REST="${BASE%/}/rest/v1"
H=(-H "apikey: ${KEY}" -H "Authorization: Bearer ${KEY}")
```
Se `BASE` ou `KEY` vierem vazios → saia 0 (não há como narrar).

Helpers (use curl com `--max-time 10`):
- **GET**: `curl -fsS "${H[@]}" "${REST}/<tabela>?<filtros>&select=<cols>"`
- **PATCH**: `curl -fsS -X PATCH "${H[@]}" -H "Content-Type: application/json" -H "Prefer: return=minimal" "${REST}/<tabela>?id=eq.<id>" -d '<json>'`
- **POST**: `curl -fsS -X POST "${H[@]}" -H "Content-Type: application/json" -H "Prefer: return=minimal" "${REST}/<tabela>" -d '<json>'`

Ao montar JSON com texto que VOCÊ escreveu, gere com `jq -nc --arg ...` para escapar corretamente
(nunca concatene string crua de conteúdo).

## 3. Passo a passo

### Passo 1 — Carregar o watch
```
GET /autonomous_watches?id=eq.${WATCH_ID}&select=*
```
Se não retornar linha → saia 0. Guarde: `phase`, `session_id`, `client_id`, `agent_job_id`,
`publish_job_id`, `target_id`, `target_hint`, `last_event_ts`, `last_narrated_milestone`,
`created_at`, `result`.

**Se `phase != 'watching'` → saia 0** (Fase 1 só trata `watching`).

### Passo 2 — Guarda de timeout
Se `now - created_at > 45 min` e ainda em `watching` → narre uma vez que a tarefa demorou demais e
encerre como falha: insira narração (kind `system`) "A geração está demorando mais que o esperado;
vou encerrar o modo autônomo por segurança." e PATCH no watch `phase='failed'`, `closed_at=now`.
Saia 0.

### Passo 3 — Ler o job de CRIAÇÃO observado
```
GET /agent_jobs?id=eq.${agent_job_id}&select=id,kind,status,error,started_at,finished_at,args,landing_page_id
```
Ramifique por `status`:

- **`pending` / `claimed`**: a tarefa ainda não começou de fato. Marco = `queued`. Se
  `last_narrated_milestone != 'queued'`, narre algo como "O pedido está na fila; os agentes
  começam em instantes." e grave `last_narrated_milestone='queued'`. Senão, nada. Saia.

- **`running`**: a tarefa está em andamento → **Passo 4** (narrar eventos novos).

- **`failed`**: narre "A criação da landing page falhou." (sem vazar stack/erro técnico cru — só
  o fato). PATCH `phase='failed'`, `closed_at=now`. Saia.

- **`completed`**: a skill de criação terminou (já enfileirou a publicação) → **Passo 5**.

### Passo 4 — Narrar progresso (job `running`)
Leia os eventos novos do run (a correlação é `run_id = agent_job.id`):
```
GET /agent_events?run_id=eq.${agent_job_id}&ts=gt.${last_event_ts|epoch}&select=ts,agent_name,agent_type,event_type,summary&order=ts.asc
```
(Se `last_event_ts` for nulo, use `1970-01-01T00:00:00Z`.)

- Se **não** houver eventos novos → não narre (evita "ainda trabalhando" repetido). Saia 0.
- Se houver, **componha UMA frase natural em pt-BR** resumindo o que avançou desde o último tick,
  no estilo pedido pelo operador: *"Atualização: os agentes concluíram o scrape e a arquitetura, e
  lançaram o subagente de copy."* Use os `summary`/`agent_name`/`agent_type`:
  - `agent_type='subagent'` + `event_type='start'` → "lançaram o subagente de <nome>".
  - `agent_type='subagent'` + `event_type='end'` → "concluíram o subagente de <nome>".
  - `tool`/`step` → use o `summary` (ex.: "scraping da landing page", "gerando criativo visual",
    "buildando a landing page", "publicando no Cloudflare").
  Agrupe; não leia evento por evento como robô. Máx ~2 frases curtas (é fala).
- Insira a narração (Passo 6) e PATCH `last_event_ts` = maior `ts` lido. Saia.

### Passo 5 — Job de criação concluído: resolver página + publicação
1. **Resolver a landing page** (se `target_id` ainda nulo):
   - O `nome`/subdomínio está em `agent_jobs.args` do job de criação (campo `nome`) ou em
     `target_hint`. Busque:
     ```
     GET /landing_pages?client_id=eq.${client_id}&subdomain=eq.${nome}&select=id,subdomain,status,url,draft_status&order=created_at.desc&limit=1
     ```
   - Se achou, grave `target_id` e `target_hint` no watch.
   - Se NÃO achou ainda (a linha pode levar um instante) → não narre; saia 0 (re-tenta no próximo tick).
2. **Resolver o job de publicação** (se `publish_job_id` ainda nulo):
   ```
   GET /agent_jobs?landing_page_id=eq.${target_id}&kind=eq.landing_publish&select=id,status,error&order=created_at.desc&limit=1
   ```
   Grave `publish_job_id` se achou.
3. **Decidir pelo estado da publicação**:
   - **publish ainda `pending`/`claimed`/`running`** (ou ainda não existe): a página foi gerada e
     está **publicando**. Se `last_narrated_milestone != 'publishing'`, narre "A página foi gerada;
     os agentes estão publicando agora." e grave `last_narrated_milestone='publishing'`. Continue
     lendo os eventos do publish no próximo tick (run_id = publish_job_id) — você pode, neste mesmo
     ramo, ler `agent_events?run_id=eq.${publish_job_id}&ts=gt....` e narrar o build/deploy como no
     Passo 4. Saia.
   - **publish `completed`** e `landing_pages.status` indica no ar (status `deployed`/`live` e `url`
     preenchida): **CONCLUSÃO**. Narre a fala final (kind `status`): *"Pronto! A landing page foi
     criada e já está no ar em <url falada>."* Fale a URL de forma natural (ex.: "promo ponto
     b-2-tech ponto i-o"). PATCH no watch: `result` = merge com `{ "url": "<url>" }`,
     `phase='done'`, `closed_at=now`.
     > Fase 1 encerra aqui. (Nas Fases 2/3, em vez de `done`, isto vira `reviewing` → revisão visual
     > server-side → `notifying` → email. NÃO faça isso agora.)
   - **publish `failed`**: narre "A página foi gerada, mas a publicação falhou." PATCH `phase='failed'`,
     `closed_at=now`. Saia.

### Passo 6 — Inserir a narração
Para QUALQUER fala decidida acima:
```bash
BODY="$(jq -nc --arg w "$WATCH_ID" --arg s "$SESSION_ID" --arg t "$TEXTO" --arg k "$KIND" \
  '{watch_id:$w, session_id:$s, text:$t, kind:$k}')"
curl -fsS -X POST "${H[@]}" -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  "${REST}/ultron_narrations" -d "$BODY" --max-time 10
```
`KIND` ∈ {`status`, `system`}. Use `status` para progresso/conclusão; `system` para avisos
(timeout/encerramento). Uma narração por tick.

### Passo 7 — Atualizar o watch
Um único PATCH com os campos que mudaram (`last_event_ts`, `last_narrated_milestone`, `target_id`,
`target_hint`, `publish_job_id`, `phase`, `result`, `closed_at`). Lembre: o trigger `set_updated_at`
e o claim já cuidam de `updated_at`.

### Passo 8 — Saída (stdout)
Imprima 1–2 linhas: `watch=<id> phase=<novo> narrated=<sim/não> milestone=<...>`. Isso vira o log do
tick (não é fala).

## 4. Critério de sucesso (de um tick)
- No máximo **uma** linha nova em `ultron_narrations` para a `session_id` do watch.
- O watch reflete o progresso (cursores avançados) ou a conclusão (`phase=done` + `result.url`).
- Reexecutar o tick sem novos eventos NÃO insere narração duplicada.

## 5. Anti-padrões (NÃO faça)
- ❌ Perguntar qualquer coisa ao operador (headless).
- ❌ Narrar "ainda trabalhando" quando não há evento novo (spam).
- ❌ Inserir mais de uma narração por tick.
- ❌ Vazar erro técnico cru/stack na fala (diga só o fato: "a publicação falhou").
- ❌ Implementar revisão visual ou email (são Fases 2/3) — Fase 1 vai de `watching` direto a `done`.
- ❌ Tocar na conta Meta, criar/editar/publicar qualquer coisa. Você só LÊ e narra.
- ❌ Usar o MCP do Supabase (indisponível headless) — use REST/curl.

## 6. Pré-requisitos
- Tabelas `autonomous_watches` + `ultron_narrations` e RPC `claim_autonomous_watch`
  (migration `20260604000001_add_autonomous_mode`).
- `agent_events.run_id` carimbado com o `agent_job.id` (scripts/emit-from-stream.py).
- Env do runner: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
