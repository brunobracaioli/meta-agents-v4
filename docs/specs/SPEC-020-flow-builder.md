# SPEC-020 — Flow Builder: automações visuais em canvas (estilo ManyChat/n8n)

| Campo | Valor |
|---|---|
| Status | Draft |
| Data | 2026-07-03 |
| Autor | brunobracaioli |
| ADRs | [0034](../adr/0034-flow-builder-dag-over-agent-jobs.md) |
| Threat model | `docs/security/threats/flow-builder.md` (entregável do PR da Wave 2 — ver §7) |
| Depende de | [SPEC-017](SPEC-017-multi-operator-multitenant.md) (multi-tenant), [SPEC-018](SPEC-018-client-and-skill-management.md) (padrões de version otimista, gates de runner), ADR 0009 (fila `agent_jobs`), ADR 0029 (connector Meta B2 Tech) |

## 1. Objetivo

Hoje o operador dispara **skills monolíticas** por pedido ao Ultron (ex.:
`create-traffic-brunobracaioli-campaign` faz scrape → copy → imagem → Meta numa única sessão
`claude -p`). O pipeline é fixo, opaco e não-recombinável: mudar a ordem, trocar uma etapa ou
inserir uma revisão humana exige editar uma skill e redeployar o runner.

Este SPEC entrega o **Flow Builder**: uma página `/dashboard/flows` onde o operador monta
visualmente um pipeline com **cards conectáveis** — cada card com **input(s)**, **config**,
**output** e **conectores tipados** — genérico para qualquer nicho/cliente. Cards da v1:

1. **Scraping** — operador informa a URL; agents extraem o brief da página.
2. **Copy** — conectado ao scraping; gera **3 variações** de copy de anúncio, cada uma com um
   gatilho mental (angle) distinto.
3. **Criativo de imagem** — conectável ao scraping E/OU à copy; o operador anexa **referências
   de imagem/logos que DEVEM aparecer** nas imagens geradas (gpt-image-2 via `/v1/images/edits`).
4. **Aprovação humana** — o flow pausa; o operador revisa copy/criativos no dashboard e aprova.
5. **Meta MCP B2 Tech** — operador escolhe tipo de campanha, pixel, página, link e orçamento;
   cria campanha + ad set + creatives + ads via connector `MCP_META_ADS_B2_TECH` — **tudo PAUSED**.

Cards com contrato já especificado para waves posteriores (§4.9): condição/filtro, trigger
agendado, vídeo (Seedance), landing page e notificação Telegram.

**Princípio arquitetural (ADR 0034):** o Flow Builder **não introduz um segundo executor**. Um
"Run" congela um snapshot do grafo e cada card vira **1 `agent_jobs`** (`kind='flow_step'`)
executado pela skill genérica `flow-step-runner` no runner Fly existente — reusando claim
escopado, telemetria (`agent_events`), timeout e as barreiras de tenancy já validadas.

### Fora de escopo (v1)

- **Ativação de campanha** dentro do flow — ativar = gasto real e continua no fluxo `activate`
  existente (confirmação 2-turnos do Ultron). O card Meta **cria PAUSED, nunca ativa**.
- Edição colaborativa em tempo real do canvas (last-write-wins com version otimista basta).
- Sub-flows / flow chamando flow.
- Cron arbitrário no trigger agendado (reusa o picker fechado de `skill_schedules`, ADR 0030).
- Card de vídeo, LP, condição, schedule e Telegram (especificados aqui, implementados em waves).

## 2. Modelo conceitual

```
operador ─1:N─> flows (definição: graph jsonb {nodes, edges}, versionado)
                  │
                  └─1:N─> flow_runs (snapshot imutável do grafo + status do run)
                            │
                            └─1:N─> flow_step_runs (1 por node; config/input/output jsonb)
                                      │
                                      └─0:1─> agent_jobs (kind='flow_step') ─> agent_events
```

### 2.1 Taxonomia de cards

| Tipo | O que é | Custa sessão de IA? | Exemplos |
|---|---|---|---|
| **trigger** | inicia um run | não | manual (botão Run), `schedule` (wave 5) |
| **action** | trabalho agentic executado no runner | sim (1 job) | `scrape`, `copy`, `image_creative`, `meta_campaign`, `video_creative`, `landing_page`, `notify_telegram` |
| **gate** | resolvido pelo motor em SQL, sem job | não | `approval`, `condition` |

### 2.2 Regras do grafo

- **DAG estrito** — ciclos são erro de validação (Kahn), no client e no server.
- **Conexão tipada** — uma edge só é válida se o `outputType` do node origem ∈ `accepts` da
  porta destino (§4.1). Validado ao conectar (client) e no Run (server).
- Edges carregam `sourceHandle`/`targetHandle` (portas explícitas) — é assim que o motor
  resolve **qual** output upstream alimenta **qual** input (multi-input do card de imagem).
- Máx. **30 nodes** por flow; portas `required` precisam estar conectadas; ≥1 node executável.
- Nodes sem caminho até um trigger implícito (manual) são erro ("node órfão desconectado") —
  na v1 o trigger manual é implícito: todo node source (sem inputs) inicia junto no Run.

## 3. Contratos — Banco (Supabase)

Migrations em `supabase/migrations/20260704*` (numeração a ajustar na implementação). RLS segue
o padrão ADR 0026: **SELECT para `authenticated` escopado por `operator_id = auth.uid()`; zero
policies de write** — todo write via `service_role` (Hono API e runner).

### 3.1 `public.flows` — definição

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `operator_id` | uuid not null | references `operators(id)` on delete cascade |
| `client_id` | uuid not null | references `clients(id)` on delete cascade — flows são por cliente (resolve ad account, budget cap, materiais) |
| `name` | text not null | `char_length between 1 and 120` |
| `description` | text | |
| `status` | text not null | `draft` \| `active` \| `archived` (default `draft`) |
| `graph` | jsonb not null | `{"nodes":[...],"edges":[...]}` — espelha o estado do React Flow (§3.6) |
| `version` | integer not null | default 1; concorrência otimista (padrão `client_skills`: PATCH com `version` → 409 `version_conflict`) |
| `created_at`/`updated_at` | timestamptz | trigger `set_updated_at` |

Índice: `flows_operator_idx on (operator_id, updated_at desc)`.

> **Decisão:** grafo em **jsonb**, não linhas normalizadas — o editor salva/carrega em 1
> operação, nunca há query por edge, e o grafo só é interpretado server-side no Run. **Sem**
> tabela `flow_versions`: o snapshot em `flow_runs` já preserva exatamente o que rodou;
> histórico completo de edição é future work sem migração destrutiva.

### 3.2 `public.flow_runs` — execução (snapshot imutável)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `flow_id` | uuid not null | references `flows(id)` on delete cascade |
| `operator_id` / `client_id` | uuid not null | denormalizados (RLS + claim escopado, como `agent_jobs`) |
| `status` | text not null | `running` \| `awaiting_approval` \| `completed` \| `failed` \| `cancelled` (default `running`) |
| `graph_snapshot` | jsonb not null | grafo congelado no Run — **editar o flow depois não afeta o run** |
| `flow_version` | integer not null | versão do flow no momento do Run (auditoria) |
| `requested_by` | text not null | `operator` \| `schedule` \| `ultron` (default `operator`) |
| `error` | text | resumo sanitizado quando `failed` |
| `started_at` | timestamptz not null | default now() |
| `finished_at` | timestamptz | |

Índice único parcial (mesmo racional do `agent_jobs_one_active_per_kind`):

```sql
create unique index flow_runs_one_active_per_flow
  on public.flow_runs (flow_id)
  where status in ('running','awaiting_approval');
```

### 3.3 `public.flow_step_runs` — 1 linha por node do snapshot

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `run_id` | uuid not null | references `flow_runs(id)` on delete cascade |
| `node_id` | text not null | id do node no `graph_snapshot` (gerado pelo editor); **unique (run_id, node_id)** |
| `node_type` | text not null | CHECK: `scrape` \| `copy` \| `image_creative` \| `meta_campaign` \| `approval` \| `condition` (waves 5+: `video_creative`, `landing_page`, `notify_telegram`) |
| `status` | text not null | `pending` \| `queued` \| `running` \| `awaiting_approval` \| `completed` \| `failed` \| `skipped` \| `cancelled` (default `pending`) |
| `config` | jsonb not null | snapshot do config do node no Run (default `{}`) |
| `input` | jsonb | montado por `advance_flow_run` a partir dos outputs upstream (§5.2) |
| `output` | jsonb | contrato de saída do node (§4); **≤ 64KB** — artefatos grandes vão pro Storage e aqui só URLs |
| `agent_job_id` | uuid | references `agent_jobs(id)` — null em gates |
| `attempt` / `max_attempts` | integer not null | default 0 / 1 (retry por card; operador pode subir p/ 2 no painel — cap 3) |
| `error` | text | tail sanitizado |
| `started_at` / `finished_at` / `created_at` | timestamptz | |

Índice: `flow_step_runs_run_idx on (run_id, status)`.

Transições de status permitidas (enforced nas RPCs, §5):

```
pending → queued → running → completed | failed
pending → awaiting_approval → queued (aprovado) | cancelled (rejeitado)   [gate approval]
pending → completed | skipped                                             [gate condition]
failed  → pending (retry, se attempt < max_attempts)
qualquer não-terminal → cancelled (cancel do run)
```

### 3.4 `public.flow_assets` + bucket `flow-assets`

Referências de imagem/logo do card `image_creative` (espelho do padrão `landing-assets`):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `flow_id` | uuid not null | references `flows(id)` on delete cascade |
| `operator_id` | uuid not null | ownership no endpoint de upload |
| `path` | text not null | path no bucket público `flow-assets` (`<flow_id>/<ts>-<rand>.<ext>`) |
| `mime` | text not null | allowlist: `image/png`, `image/jpeg`, `image/webp` |
| `size_bytes` | integer not null | ≤ 5MB |
| `created_at` | timestamptz | |

Bucket **público** (o runner baixa por URL e o painel pré-visualiza sem signed URL; refs de
marca não são secretas). Criação idempotente no endpoint, como `landing-assets`.

### 3.5 Mudanças em `agent_jobs`

Migration própria (padrão 20260615/20260703):

1. **Novo kind `'flow_step'`** no CHECK de `kind`.
2. **Recriar `agent_jobs_one_active_per_kind` EXCLUINDO `flow_step`** — sem isso, dois cards do
   mesmo flow (ou de flows diferentes do mesmo cliente) colidem no unique. Precedente:
   `landing_publish` (20260603) e `custom` (20260625) já foram excluídos com dedup próprio.
3. **Dedup próprio por step:**

```sql
create unique index agent_jobs_one_active_per_flow_step
  on public.agent_jobs ((args->>'step_run_id'))
  where kind = 'flow_step' and status in ('pending','claimed','running');
```

O enqueue de `flow_step` é feito **pelas RPCs do motor** (service_role), nunca direto pela UI.
`skill` é sempre a constante `'flow-step-runner'` — o grafo **não escolhe skill** (§7).

### 3.6 Shape do `graph` jsonb

Subconjunto serializável do estado do React Flow (validado por Zod em `web/lib/flows/validate.ts`):

```jsonc
{
  "nodes": [
    {
      "id": "n_a1b2",                  // ^[a-z0-9_]{2,24}$, gerado pelo editor
      "type": "scrape",                // node_type do registry
      "position": { "x": 120, "y": 80 },
      "config": { "url": "https://exemplo.com/pagina-de-vendas" }
    }
  ],
  "edges": [
    {
      "id": "e_1",
      "source": "n_a1b2", "sourceHandle": "out",
      "target": "n_c3d4", "targetHandle": "scrape"   // = key da inputPort destino
    }
  ]
}
```

Campos extras do React Flow (selected, measured, etc.) são **strip** no save — o banco guarda
só o essencial (id, type, position, config, edges com handles).

## 4. Contratos — Cards (node registry)

Fonte da verdade: **`web/lib/flows/node-registry.ts`**. Cada tipo declara:

```ts
type NodeTypeDef = {
  type: NodeType;
  kind: "trigger" | "action" | "gate";
  label: string;                       // exibição na paleta
  configSchema: z.ZodType;             // painel de config + validação save/run
  inputPorts: { key: string; accepts: PayloadType[]; required: boolean }[];
  outputType: PayloadType | null;      // null p/ sinks sem downstream útil? não — todos emitem
  outputSchema: z.ZodType;             // validado pelo runner antes do complete
};
```

**Payload types** (semânticos, versionáveis): `ScrapeResult`, `CopyVariations`, `ImageAssets`,
`MetaCampaignRef`, `Approval`, `VideoAssets`, `LandingPageRef`.

O runner valida o output contra o **mesmo contrato** antes de `complete_flow_step` — os JSON
Schemas ficam espelhados em `.claude/skills/flow-step-runner/contracts/*.json` (fonte = Zod do
web; teste de paridade no CI é critério da Wave 4).

> **Prompt-injection posture:** todo `input` de upstream (conteúdo scrapeado, copy gerada) entra
> nos prompts dos steps como **dados não-confiáveis** — o SKILL.md instrui explicitamente a não
> obedecer instruções embutidas nesses dados (mesma postura do `copywriter` hoje).

### 4.1 `scrape` (action, source — sem inputs)

- **config:** `{ url: string }` — `https://` obrigatório; server-side rejeita IP privado /
  link-local / localhost / porta não-padrão (defesa em camadas com o SSRF-guard do subagent).
- **executa:** subagent `scrape-extractor` existente (haiku, WebFetch, anti-SSRF +
  anti-prompt-injection embutidos).
- **output `ScrapeResult`:**

```jsonc
{
  "sourceUrl": "https://…",
  "extracted": {
    "theme": "…", "valueProposition": "…", "primaryCta": "…",
    "uniqueSellingPoints": ["…"],            // ≤5
    "tone": "professional|casual|urgent|inspirational|technical",
    "paletteHints": ["#0A2540", "…"]
  },
  "warnings": [],
  "scrapedAt": "2026-07-03T12:00:00Z"
}
```

### 4.2 `copy` (action)

- **inputs:** `scrape: ScrapeResult` (required).
- **config:** `{ objective: 'traffic'|'sales'|'leads', variations: 3, toneHints?: string≤200, language: 'pt-BR'|'en-US' }`
  — `variations` é literal 3 na v1 (o pedido); vira 1..5 depois sem quebra de contrato.
- **executa:** 3 chamadas ao subagent `copywriter` existente, uma por angle (gatilho mental)
  — ex.: autoridade, dor, prova social/escassez — cada uma recebendo o `ScrapeResult` como dado.
- **output `CopyVariations`:**

```jsonc
{
  "variations": [
    {
      "headline": "…",            // ≤40 chars
      "primaryText": "…",         // ≤250 chars
      "description": "…",         // ≤30 chars
      "callToActionType": "LEARN_MORE",   // enum Meta
      "angle": "authority"        // gatilho mental — distinto por variação
    }
    // ×3
  ],
  "language": "pt-BR"
}
```

### 4.3 `image_creative` (action, **multi-input**)

- **inputs:** `scrape?: ScrapeResult`, `copy?: CopyVariations` — **regra de grafo: ≥1
  conectado.** Com `copy` conectada, gera 1 imagem por variação alinhada ao angle; só com
  `scrape`, gera a partir do brief extraído.
- **config:**

```jsonc
{
  "aspect": "1:1" | "9:16" | "1.91:1",
  "variants": 1,                       // por copy variation; 1..3
  "referenceAssetIds": ["uuid", "…"],  // 0..16, FKs em flow_assets — logos/refs OBRIGATÓRIOS
  "brandNotes": "string ≤300 opcional" // ex.: "paleta navy/laranja, sem texto na imagem"
}
```

- **executa:** subagent `image-prompt-generator` monta o prompt; skill `image-generate`
  (gpt-image-2) com as refs baixadas do bucket `flow-assets` para paths locais e passadas em
  `refs=` — com refs presentes o `image-generate` usa **`/v1/images/edits`**, que é o mecanismo
  que garante que logos/referências **apareçam** na imagem gerada. Depois, upload dos PNGs ao
  bucket **público `ad-ingest`** (a Meta exige `image_url` público — ADR 0003).
- **output `ImageAssets`:**

```jsonc
{
  "assets": [
    { "publicUrl": "https://…/ad-ingest/…png", "path": "…", "aspect": "1:1", "copyIndex": 0 }
  ]
}
```

`copyIndex` liga imagem ↔ variação de copy (null quando gerado só do scrape).

### 4.4 `approval` (gate, **v1**)

- **inputs:** `payload: qualquer PayloadType` (required) — tipicamente recebe `CopyVariations`
  ou `ImageAssets`; o painel renderiza preview do que chegou.
- **config:** `{ notifyTelegram: boolean }` (default true — envia resumo + link do run).
- **comportamento:** resolvido pelo motor **sem job**: `advance_flow_run` marca o step e o run
  como `awaiting_approval`. O operador vê o card roxo no canvas com preview (copies renderizadas,
  imagens em grid) e botões **Aprovar** / **Rejeitar**:
  - Aprovar → RPC `approve_flow_step` → step `completed`, run volta a `running`, advance.
  - Rejeitar → step + run `cancelled` (motivo opcional em `error`).
- **output `Approval`:** `{ approved: true, approvedAt, approvedBy }` — e **repassa o payload
  de entrada intacto** (`passthrough`), para o downstream consumir como se viesse do upstream
  original (o card de aprovação é transparente no fluxo de dados).

### 4.5 `meta_campaign` (action, sink)

- **inputs:** `copy: CopyVariations` (required), `images: ImageAssets` (required).
- **config:**

```jsonc
{
  "campaignType": "OUTCOME_TRAFFIC" | "OUTCOME_SALES" | "OUTCOME_LEADS",
  "pixelId": "…",          // dropdown via list_pixels (obrigatório p/ SALES/LEADS)
  "pageId": "…",           // dropdown via list_pages
  "linkUrl": "https://…",
  "dailyBudgetCents": 3000, // int > 0
  "campaignName": "opcional ≤80"
}
```

- **validação server-side no Run (não no save):** `dailyBudgetCents ≤
  clients.daily_budget_cap_cents` → senão **422 com mensagem clara; nunca clamp silencioso**.
- **executa:** via connector `MCP_META_ADS_B2_TECH`: `create_campaign` (CBO, **PAUSED**) →
  `create_adset` (Advantage+, otimização conforme `campaignType`; `OFFSITE_CONVERSIONS` +
  pixel p/ SALES/LEADS) → por par copy×imagem: `create_creative` (image_url público em
  `link_data.picture`… conforme padrão validado) + `create_ad` (**PAUSED**). Persiste
  `campaigns`/`ad_sets`/`creatives`/`ads`/`operation_logs` no Supabase (padrão da
  create-traffic) — o Flow Builder **não substitui** o read model existente, alimenta-o.
- **output `MetaCampaignRef`:**

```jsonc
{
  "campaignId": "…", "adsetId": "…",
  "ads": [{ "adId": "…", "creativeId": "…", "copyIndex": 0, "imageUrl": "…" }],
  "status": "PAUSED"
}
```

### 4.6 `condition` (gate — Wave 4)

- **inputs:** `payload: qualquer` (required). **config:** predicado declarativo
  `{ path: "extracted.tone", op: "eq"|"neq"|"gt"|"lt"|"contains"|"exists", value: … }`.
- Avaliado **em SQL** dentro de `advance_flow_run` (jsonb path ops) — custo zero. Não satisfeito
  → step `skipped` e **skip em cascata** de todo downstream exclusivo dessa branch. Satisfeito
  → `completed` com passthrough do payload.

### 4.7 `schedule` trigger (Wave 5)

Tabela `flow_schedules` espelhando `skill_schedules` (recurrence jsonb, `compute_next_run`,
claim escopado, intervalo mínimo ≥ 15 min) + extensão do poller de schedules para chamar
`start_flow_run(..., requested_by:'schedule')`. Nada novo conceitualmente — reuso do ADR 0030.

### 4.8 `video_creative` (action — Wave 5)

Espelho do `image_creative` usando a skill Seedance validada (text/image-to-video); config
`{ mode: 'text'|'image', durationSec, aspect }`; output `VideoAssets { assets: [{ publicUrl,
videoId? }] }`. O card Meta ganha depois uma porta `video?: VideoAssets` (video ads via
`/advideos` — ADR 0023).

### 4.9 `landing_page` e `notify_telegram` (actions — Wave 5)

- `landing_page`: encadeia as skills `create-landing-page-*` + job `landing_publish`
  existentes; output `LandingPageRef { url, landingPageId }` — o `url` pode alimentar o
  `linkUrl` do card Meta (mapeamento de porta → campo de config é extensão da Wave 5).
- `notify_telegram`: action barata (sem sessão de IA — REST direto no motor ou mini-job);
  config `{ message?: template }`; envia resumo do run pelo canal Telegram já integrado.

## 5. Motor de execução

### 5.1 Decisão central: 1 `agent_job` por card (ADR 0034)

Confirmado com o operador. Consequências: retry e telemetria **por card**, card de aprovação
pausando por horas sem custo, timeout de 25 min **por card** (não pro flow todo). Custo aceito:
até ~1 min de fila por hop quando o hop depende do poller (mitigado pelo advance inline, abaixo)
e 1 sessão `claude -p` por action.

### 5.2 RPCs (SQL `security definer set search_path=''`, EXECUTE revogado de
`public/anon/authenticated` — padrão `claim_agent_job`)

- **`start_flow_run(p_flow_id, p_operator_id, p_requested_by)`** — valida ownership, congela
  `graph_snapshot`, cria `flow_runs` + 1 `flow_step_runs` por node (`pending`, config
  congelado), chama `advance_flow_run` inline. Colisão no índice one-active → erro mapeado
  para 409 na API.
- **`advance_flow_run(p_run_id)`** — **idempotente**, o coração do motor:
  1. Para cada step `pending` cujos upstreams (edges do snapshot) estão todos `completed`
     (ou resolvidos como `skipped` conforme regra do `condition`): monta `input` jsonb
     mapeando `edge.targetHandle` → chave, a partir dos `output` upstream; então:
     - **action** → seta `queued` + INSERT em `agent_jobs` `{client_id, operator_id,
       skill:'flow-step-runner', kind:'flow_step', args:{step_run_id}, requested_by:'flow'}`;
     - **approval** → step e run `awaiting_approval` (para o avanço);
     - **condition** → avalia o predicado e marca `completed`/`skipped` (+ skip em cascata).
  2. Se existe step `failed` sem retry restante → run `failed` (steps não-terminais →
     `cancelled`). Se todos os steps são terminais → run `completed`.
- **`complete_flow_step(p_step_run_id, p_output jsonb)`** — grava output (guard ≤64KB), marca
  `completed`, `finished_at`, e **chama `advance_flow_run` na mesma transação** → o próximo hop
  é enfileirado imediatamente, sem esperar o próximo tick do poller.
- **`fail_flow_step(p_step_run_id, p_error text)`** — se `attempt < max_attempts`: volta a
  `pending`, incrementa `attempt`, re-advance (re-enfileira). Senão: `failed` + advance (que
  falha o run).
- **`approve_flow_step(p_step_run_id, p_operator_id, p_approved boolean, p_reason text)`** —
  valida ownership + status `awaiting_approval`; aprova (completed + passthrough + advance) ou
  rejeita (step + run `cancelled`).
- **`cancel_flow_run(p_run_id, p_operator_id)`** — run `cancelled`; steps não-terminais →
  `cancelled`; jobs `pending` correspondentes → `cancelled` (jobs já `running` terminam e o
  `complete_flow_step` em run cancelado vira no-op).

### 5.3 Execução no runner

1. `poll-agent-jobs.sh` (claim inalterado) pega o job `flow_step`. Mudanças mínimas no poller:
   aceitar o kind, e **validar que `args.step_run_id` casa `^[0-9a-f-]{36}$`** — é o **único
   token que cruza o shell**; config/input jsonb nunca são interpolados em comando.
2. `run-skill.sh flow-step-runner step_run_id=<uuid>` → `claude -p` com `AGENT_JOB_ID` env →
   telemetria por card de graça (`agent_events.run_id = AGENT_JOB_ID`).
3. Skill **`.claude/skills/flow-step-runner/`** (`SKILL.md` + `steps/scrape.md`,
   `steps/copy.md`, `steps/image-creative.md`, `steps/meta-campaign.md`):
   1. `GET rest/v1/flow_step_runs?id=eq.<uuid>&select=*,run:flow_runs(client_id,operator_id,status)`
      (REST com `SUPABASE_SECRET_KEY` no header `apikey` — padrão headless). Run não-`running`
      → exit 0 no-op (cancel gracioso).
   2. PATCH step → `running`, `started_at`.
   3. Dispatch por `node_type` → seção `steps/<tipo>.md`, usando os building blocks existentes
      (subagents, `image-generate`, MCP Meta). `input`/`config` entram como dados.
   4. Valida o output contra `contracts/<tipo>.json`.
   5. `POST rest/v1/rpc/complete_flow_step`. Erro irrecuperável → `rpc/fail_flow_step` com
      mensagem sanitizada (sem tokens/stack).
4. **Safety-net `scripts/poll-flow-runs.sh`** (novo, crontab `* * * * *`, clone estrutural do
   `poll-skill-schedules.sh`, single-flight lock): (a) steps `queued|running` cujo
   `agent_jobs.status ∈ (failed, cancelled)` (timeout/crash — a skill nunca chamou complete) →
   `fail_flow_step`; (b) re-chama `advance_flow_run` de todo run `running` (idempotente —
   destrava qualquer corrida perdida).

### 5.4 Passagem de dados

- **Pequeno (≤64KB):** `flow_step_runs.output` (contratos do §4). `agent_jobs.result` continua
  sem uso — a verdade do flow é o step run.
- **Grande (imagens/vídeos):** Storage (`ad-ingest`/`flow-assets`); o output carrega URLs.

## 6. Contratos — API (web) e UI

### 6.1 API — sub-router Hono `web/lib/api/flows.ts` (montado no catch-all como os existentes)

Padrão por rota: **auth (middleware) → ownership (`assertOperatorOwnsClient` / operator do
flow) → Zod (`web/lib/flows/validate.ts`) → write via `db()` service_role**. Reads de UI via
`getReadClient()` (RLS por operador).

| Rota | Descrição |
|---|---|
| `GET /api/flows` · `POST /api/flows` | listar / criar (`{client_id, name}`) |
| `GET /api/flows/:id` · `PATCH /api/flows/:id` | ler / salvar `{graph, name?, status?, version}` — 409 `version_conflict` |
| `DELETE /api/flows/:id` | arquivar (soft: `status='archived'`) |
| `POST /api/flows/:id/assets` | multipart (clone de `landing-pages.ts` `POST /:id/assets`) → bucket `flow-assets` + linha `flow_assets` |
| `POST /api/flows/:id/run` | valida grafo server-side (mesmo módulo do client) + budget cap do card Meta + gate `operatorRunnerReady` → RPC `start_flow_run` → `202 {runId}`; 409 se run ativo; **rate-limited** |
| `GET /api/flows/:id/runs` | histórico |
| `GET /api/flow-runs/:runId` | run + steps (status/output/error/agent_job_id) — alvo do polling 4s |
| `POST /api/flow-runs/:runId/cancel` | RPC `cancel_flow_run` |
| `POST /api/flow-runs/:runId/steps/:stepId/approve` | `{approved, reason?}` → RPC `approve_flow_step` |
| `POST /api/flow-runs/:runId/steps/:stepId/retry` | re-enfileira step `failed` (respeita cap de attempts) |

Dropdowns do card Meta (`pixelId`/`pageId`): endpoints proxy finos `GET
/api/flows/meta/pixels?client_id=` / `.../pages` chamando o connector server-side (nunca token
no browser).

### 6.2 UI — React Flow

- **Dependência nova: `@xyflow/react`** (MIT). Compatível com a CSP nonce-based do projeto
  (`style-src 'unsafe-inline'` já liberado; sem conexões externas). Alternativas descartadas no
  ADR 0034.
- **`web/app/(app)/dashboard/flows/page.tsx`** — lista (nome, cliente, status, último run) +
  criar. Item novo na nav de `web/app/(app)/dashboard/layout.tsx`.
- **`web/app/(app)/dashboard/flows/[id]/page.tsx`** — editor client-side:
  - canvas React Flow com custom nodes (visual do design system atual — Tailwind, tema
    dark/cyan do HUD);
  - **paleta lateral** de cards (drag-in), agrupada por taxonomia (trigger/action/gate);
  - **painel de config** do node selecionado — form gerado do `configSchema` Zod do registry;
    upload de refs no card de imagem (`POST /:id/assets`) com preview em grid;
  - barra superior: nome, estado do save, botão **Run** (desabilitado com lista de erros de
    validação clicável → foca o node).
- Componentes em `web/app/(app)/dashboard/flows/components/` (`flow-canvas.tsx`,
  `node-card.tsx`, `node-config-panel.tsx`, `run-overlay.tsx`); lógica pura em
  `web/lib/flows/` (`node-registry.ts`, `graph-validate.ts`, `validate.ts`).
- **Save:** autosave com debounce 2s + `version` otimista (409 → recarregar e avisar — mesmo
  contrato do editor de skills).
- **Validação client** (`graph-validate.ts`, compartilhada com o server): ciclo (Kahn), portas
  required conectadas, compatibilidade de payload types, `configSchema.safeParse` por node,
  ≥1 executável, cap 30 nodes, regra "≥1 input do image_creative".
- **Run em andamento:** editor entra em modo read-only; **polling 4s** de
  `GET /api/flow-runs/:runId` (padrão `live-feed.tsx`; sem Supabase Realtime — decisão
  deliberada do projeto). Nodes coloridos por status: pending cinza · queued âmbar · running
  pulso azul · completed verde · failed vermelho · awaiting_approval **roxo com painel de
  aprovação** (preview de copy/imagens + Aprovar/Rejeitar) · skipped tracejado. Clicar num node
  mostra `output`/`error` + eventos do HUD (filtrados por `agent_job_id`). Aba **Runs** com
  histórico e re-abertura read-only de runs passados (snapshot).

## 7. Segurança (STRIDE — resumo; threat model completo em `docs/security/threats/flow-builder.md`, entregável do PR da Wave 2)

| Ameaça | Vetor | Mitigação |
|---|---|---|
| **S**poofing | run/approve de flow alheio | middleware auth + ownership por operator em toda rota; RPCs validam `operator_id`; RLS SELECT por operador |
| **T**ampering | grafo do usuário virar execução arbitrária | **o grafo nunca escolhe skill** — `kind='flow_step'` → skill fixa `flow-step-runner`; `node_type` validado contra registry (save + run) e CHECK no DB; config/input jsonb **nunca interpolados em shell** — só o UUID `step_run_id` cruza (regex no poller); editar flow não afeta run (snapshot) |
| **R**epudiation | quem aprovou/rodou o quê | `flow_runs.requested_by`, `approve_flow_step` grava operador/timestamp no output, `operation_logs` nas entidades Meta, `agent_events` por card |
| **I**nfo disclosure | SSRF via URL de scraping; vazamento entre tenants | validação de URL em 2 camadas (API + subagent `scrape-extractor`); RLS deny-by-default + claim escopado + 3ª barreira do `run-skill.sh` (ADR 0027); erros sanitizados (tail, sem tokens) |
| **D**oS | runs em loop, flows gigantes, upload abuse | 1 run ativo por flow (índice); rate limit no POST /run; cap 30 nodes; `max_attempts ≤ 3`; timeout 25min/card; uploads: mime allowlist + ≤5MB + ≤16 refs; schedule (wave 5) herda min-interval ≥15min |
| **E**levation | flow gastar dinheiro sem controle | `dailyBudgetCents ≤ clients.daily_budget_cap_cents` (422); **tudo nasce PAUSED**; ativação fora do flow; card `approval` antes do Meta é o **template default** de novo flow; prompt-injection de conteúdo scrapeado tratada como dado não-confiável (§4) + gates de gasto a nível de API Meta (postura do ADR 0030: `allowed-tools` não é barreira sob `--dangerously-skip-permissions`) |

## 8. Critérios de aceite

**Motor**
1. Dado um flow válido `scrape→copy→approval→meta`, `POST /run` retorna 202, cria `flow_runs`
   com `graph_snapshot` e o step `scrape` fica `queued` com 1 `agent_jobs` `flow_step`.
2. Editar (ou deletar) o flow durante um run **não altera** o run em andamento.
3. `complete_flow_step` do scrape enfileira o `copy` **na mesma transação** (sem esperar poller).
4. Step cujo job estoura timeout/crasha é marcado `failed` pelo `poll-flow-runs.sh` em ≤2 min;
   com `max_attempts=2` ele volta a `pending` e re-executa; esgotado, o run vira `failed` e os
   steps restantes `cancelled`.
5. Segundo `POST /run` com run ativo → 409. `POST /run` com budget do card Meta acima do cap
   do cliente → 422 com mensagem clara (sem clamp).
6. `cancel` durante `running`: jobs pending são cancelados; um step que termina depois do cancel
   não ressuscita o run (complete vira no-op).
7. Grafo com ciclo, porta required desconectada ou tipo incompatível é rejeitado no client
   (botão Run desabilitado) **e** no server (400 com lista de erros).

**Cards**
8. `scrape` numa URL pública real produz `ScrapeResult` válido; URL com IP privado é rejeitada
   no save com erro claro.
9. `copy` produz exatamente 3 variações dentro dos limites (40/250/30, CTA do enum), com
   `angle` distinto entre elas.
10. `image_creative` com 2 refs anexadas gera imagens onde as refs aparecem (rota
    `/v1/images/edits` confirmada no manifest) e publica URLs no bucket `ad-ingest` acessíveis
    sem auth. Conectado só ao scrape (sem copy) também executa.
11. `approval` pausa o run (`awaiting_approval`), mostra preview no canvas; Aprovar retoma e o
    downstream recebe o payload original intacto; Rejeitar cancela o run. Notificação Telegram
    enviada quando configurada.
12. `meta_campaign` cria campanha + ad set + N creatives/ads no Ads Manager, **todos PAUSED**,
    com pixel/página/link do config, e persiste as entidades no Supabase (read model atual) —
    verificável em `/dashboard` e no Ads Manager.

**UI**
13. Autosave persiste em ≤3s após a última edição; conflito de versão (duas abas) mostra aviso
    e recarrega, sem corromper o grafo.
14. Durante o run, os nodes refletem o status em ≤5s (polling 4s) e o node aberto mostra
    output/erro + eventos de telemetria do card.
15. Novo flow criado a partir do template default já vem com `approval` antes do `meta_campaign`.

**Segurança**
16. Nenhum valor de config/input aparece em comando shell no runner (auditável no run log);
    `step_run_id` inválido é rejeitado pelo poller.
17. Operador B não lê nem executa flows/runs/assets do operador A (RLS + ownership nas rotas).

## 9. Riscos e limitações registradas

- **Latência por hop** dependente do poller (1 job/tick) nos caminhos de falha/reconciliação —
  aceitável na v1; mitigação conhecida: drenar N jobs por tick no `poll-agent-jobs.sh`.
- Recriar `agent_jobs_one_active_per_kind` exige janela sem jobs ativos do kind — trivial
  (feature nova, kind ainda não existe).
- Contratos duplicados Zod (web) ↔ JSON Schema (skill) — drift mitigado pelo teste de paridade
  no CI (Wave 4).
- Custo: 1 sessão `claude -p` por action card. Um flow de 4 actions ≈ custo da skill monolítica
  equivalente (mesmo trabalho, sessões menores). Fusão de cards baratos num job é future work.
- `approval` depende do operador voltar ao dashboard; a notificação Telegram (com link) é o
  mecanismo de re-engajamento.

## 10. Apêndice — proposta de waves (a detalhar na fase de implementação)

| Wave | Entrega | Testável por |
|---|---|---|
| **1 — Fundação + Editor** | migrations `flows`/`flow_assets`, `node-registry.ts`, `graph-validate.ts`, CRUD + assets (`lib/api/flows.ts`), páginas lista+editor React Flow, autosave, validação, upload de refs, nav | montar/validar/persistir o grafo dos 5 cards; refs no Storage |
| **2 — Motor + scrape/copy** | migrations `flow_runs`/`flow_step_runs`/RPCs/kind `flow_step`, skill `flow-step-runner` (scrape+copy), `poll-flow-runs.sh`, endpoints run/cancel/status, run-overlay | rodar scrape→copy E2E no Fly, outputs por node; threat model doc |
| **3 — Cards de valor** | `image_creative` (refs obrigatórias) + `meta_campaign` (cap, PAUSED) | URL → campanha PAUSED completa no Ads Manager, montada visualmente |
| **4 — Gates + robustez** | `approval` (+Telegram) *(se não antecipado na 2)*, `condition`, retry/cancel refinados, teste CI de paridade de contratos, template default com gate | cenários de falha/aprovação dos critérios 4–7 e 11 |
| **5 — Triggers + mídia** | `flow_schedules`, `video_creative`, `landing_page`, `notify_telegram`, drenagem multi-job do poller | flow agendado E2E; vídeo e LP no pipeline |

> Nota: como o `approval` entra na v1 por decisão do operador, a Wave 2 já implementa o
> mecanismo `awaiting_approval` no motor (é 1 status + 1 RPC); a Wave 4 só refina UX/Telegram.
