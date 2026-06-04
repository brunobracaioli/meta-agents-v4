# ADR 0019 — Modo autônomo do Ultron (watch loop + narração + revisão visual)

| Campo | Valor |
|---|---|
| Status | Accepted (Fases 1+2 implementadas; Fase 3 pendente) |
| Data | 2026-06-04 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/SPEC-013-ultron-autonomous-mode.md](../specs/SPEC-013-ultron-autonomous-mode.md) |
| Migrations | `20260604000001_add_autonomous_mode` + `20260604000002_add_ultron_review_bucket` (aplicadas) |
| Relacionado | [ADR 0001](0001-fly-machine-supercronic.md) (runner sem HTTP), [ADR 0007](0007-daily-summaries-and-agent-events.md) (polling deny-by-default + agent_events), [ADR 0009](0009-on-demand-agent-jobs-queue.md) (fila agent_jobs), [ADR 0010](0010-ultron-screen-vision.md) (screen vision), [ADR 0012](0012-landing-pages-on-cloudflare-pages.md) (URL publicada) |

## Context

O operador pediu um **"modo autônomo"** para o Ultron: depois de enfileirar uma tarefa longa
(ex.: gerar uma landing page, 5–25 min), ele quer poder **sair do computador** e que o Ultron:

1. **Monitore** a execução sem intervenção humana;
2. A cada X tempo, **narre por voz** o progresso ("os agentes iniciaram o scrape, concluíram a
   copy, lançaram o subagente de hero");
3. Ao concluir, **receba a URL** da página criada, **abra-a**, tire prints, **analise e opine
   por voz**, role a página em incrementos e repita até o fim;
4. **Notifique** `bruno@b2tech.io` por email que terminou;
5. **Encerre** o modo autônomo.

Restrições que moldam a decisão:

- O **Ultron headless** (skill em `claude -p` no runner Fly.io) é um **processo distinto** da
  aba do navegador do operador (Vercel) onde vivem TTS e screen vision. Qualquer narração
  gerada server-side precisa **viajar até o browser**.
- A ADR 0007 fixou o padrão de live view: **RLS fechado + polling de endpoint server-side com
  service key**, explicitamente recusando Realtime/SSE para preservar deny-by-default. Reusamos
  esse padrão; não introduzimos Realtime.
- A ADR 0001/0009 fixaram que o runner **não expõe HTTP**; disparos cross-service vão por
  **fila no Postgres + polling do supercronic**. Reusamos.
- O operador **estará ausente** durante a fase de revisão. Depender do `getDisplayMedia`
  (ADR 0010) é frágil: tela bloqueada/minimizada quebra a captura. A revisão precisa ser
  **independente da tela do operador**.
- A fase de revisão exige **opinião em linguagem natural** sobre cada print → precisa de um
  **LLM com visão**, não um poller bash puro.
- Email **não existe** no projeto (sem nodemailer/Resend/SMTP). Gmail MCP é OAuth-gated em
  headless (mesma limitação do Supabase MCP). Precisa de provider HTTP com API key.

## Decision

**Um "watch loop" durável no Postgres, dirigido pelo supercronic da Fly, que invoca uma skill
LLM por tick para narrar o progresso e, na conclusão, conduzir uma revisão visual server-side
e notificar por email.** A narração chega ao browser pelo mesmo padrão de polling da ADR 0007.

### Componentes

1. **Tabela `autonomous_watches`** (estado do modo autônomo). Colunas:
   `id uuid pk` · `client_id uuid fk→clients` · `target_kind text` (`landing_page` no v1;
   genérico) · `target_id uuid` (ex.: `landing_pages.id`) · `agent_job_id uuid null`
   (job observado em `agent_jobs`) · `run_id text null` (correlação com `agent_events`) ·
   `session_id text` (a aba do Ultron que deve falar) · `phase text`
   (`watching|reviewing|notifying|done|failed`) · `last_event_ts timestamptz null`
   (cursor de `agent_events` já narrados) · `last_narrated_milestone text null` ·
   `result jsonb` (URL final etc.) · `started_by text` · timestamps `created/updated/closed_at`.
   Índice único parcial **um watch ativo por target** `(target_kind, target_id) where phase in
   ('watching','reviewing','notifying')` para deduplicar. RLS on, deny-by-default (service key
   nos dois lados), padrão ADR 0002/0009.

2. **Tabela `ultron_narrations`** (canal servidor→browser, append-only). Colunas:
   `id uuid pk` · `watch_id uuid fk` · `session_id text` · `ts timestamptz` ·
   `text text` (fala) · `kind text` (`status|opinion|system`) · `image_path text null`
   (print da revisão, bucket privado) · `spoken_at timestamptz null` (marcado pelo browser).
   Índice `(session_id, ts)`. RLS on deny-by-default.

3. **Push da narração (reuso ADR 0007, sem Realtime):** o frontend do Ultron faz **polling**
   `GET /api/ultron/narrations?session=<id>&since=<ts>` (~2s, server-side com service key);
   para cada linha nova, **fala via TTS existente** (`/api/ultron/tts`, ADR 0011) e dá
   `PATCH` em `spoken_at`. Zero superfície de rede nova no runner; deny-by-default intacto.

4. **Tools tipadas no Ultron (web)** — `start_autonomous_mode(target_kind, target_id?)` e
   `stop_autonomous_mode()`. Seguindo ADR 0009: o usuário **não** fornece skill nem SQL; o
   server resolve target e insere a linha de `autonomous_watches` com `session_id` da aba
   atual. `start` exige confirmação em 1 turno (não gera gasto Meta, risco baixo).

5. **Skill `autonomous-watch-tick` (LLM, headless)** — disparada por tick. Por watch ativo:
   - **Fase `watching`**: lê `agent_jobs` (status) + `agent_events` (desde `last_event_ts`)
     do `run_id`, **resume os marcos novos em uma fala natural**, insere em `ultron_narrations`,
     avança o cursor. Quando o job conclui e `landing_pages.status=deployed` com URL → muda
     para `reviewing`.
   - **Fase `reviewing`**: chama o **screenshotter server-side** (item 6) para `url`, obtém
     prints incrementais (scroll 0% → 100% em passos), e para cada print **analisa com visão e
     emite opinião** em `ultron_narrations` (`kind=opinion`, com `image_path`).
   - **Fase `notifying`**: envia email (item 7), insere narração final ("vou te notificar por
     email… saindo do modo autônomo"), seta `phase=done`, `closed_at`.

6. **Screenshotter server-side (Playwright na Fly)** — `scripts/screenshot-page.mjs <url>
   <out_dir>`: headless Chromium abre a URL pública (Cloudflare), captura viewport em N passos
   de scroll, salva JPEGs e sobe ao bucket privado `creatives`/`landing-review`. **Independente
   da tela do operador** (atende o "vou ter que sair"). Lê só URLs de `landing_pages` do cliente
   (não-arbitrárias) — mitiga SSRF.

7. **Email via Resend** — `scripts/send-email.mjs` (ou endpoint server-side) usando
   `RESEND_API_KEY`. Destinatário fixo por cliente (config), assunto + corpo com a URL e um
   resumo. Sem PII além do necessário; secret em env (Fly + Vercel), nunca no código.

8. **Cron `scripts/poll-autonomous-watches.sh`** no supercronic (`* * * * *`) — cópia do
   `poll-agent-jobs.sh`: lock single-flight (`mkdir`), claima watches "due" (com backoff por
   `updated_at` p/ não narrar a cada minuto — cadência ~2–3 min em `watching`), invoca
   `run-skill.sh autonomous-watch-tick watch_id=<id>`. Reaper marca `failed` watches órfãos.

### Alternativas consideradas

- **Supabase Realtime para a narração** — rejeitado: a ADR 0007 já recusou Realtime/SSE para
  manter RLS deny-by-default; polling é suficiente (eventos de baixa frequência) e coerente.
- **Reusar `getDisplayMedia` (ADR 0010) na revisão** — rejeitado como mecanismo primário:
  depende da tela do operador ativa/desbloqueada, contradiz "vou ter que sair". Fica como
  fallback opcional se o operador estiver presente.
- **`/loop` / `ScheduleWakeup` do harness Claude Code** — são do processo interativo, não do
  Ultron headless deployado. Não atravessam para a aba do operador. Rejeitado.
- **QStash para o tick** — não configurado (ADR 0009); o supercronic já roda de minuto a
  minuto e a fila no Postgres reusa infra existente. Rejeitado por ora.
- **Gmail MCP para email** — OAuth-gated headless (mesma limitação do Supabase MCP, ver
  memória `claude-headless-runner-gotchas`). Resend (API key HTTP) é confiável headless.
- **Workflow multi-agente para a revisão** — overkill; um loop na skill basta. Fica como
  evolução se a revisão exigir verificação adversarial.

## Threat model (STRIDE — nova superfície)

- **S/T**: tools `start/stop_autonomous_mode` só inserem em tabela própria com `client_id`
  resolvido server-side (padrão ADR 0009); sem string de skill/SQL do usuário.
- **I (SSRF)**: o screenshotter recebe **apenas** URL de `landing_pages` do cliente, validada
  contra o domínio Cloudflare esperado — não navega URL arbitrária.
- **I (email)**: corpo sem PII além da URL pública e do resumo; `RESEND_API_KEY` em secret
  manager (Fly/Vercel), nunca no diff. Destinatário allow-listed por cliente.
- **D**: cadência com backoff (~2–3 min) e índice único de um watch ativo por target evitam
  loop de narração/screenshot descontrolado; reaper fecha órfãos.
- **R**: cada narração e transição de fase fica em linha auditável (`ultron_narrations` +
  `operation_logs`).

## Consequences

### Positivas
- **Zero segredo cross-service novo** além de `RESEND_API_KEY`; reusa Supabase service key,
  supercronic, agent_events, TTS, bucket. Coerente com ADR 0001/0007/0009.
- **Revisão robusta** independente da tela do operador (server-side Playwright).
- **Genérico por schema**: `target_kind` já abre caminho p/ observar campanha/análise sem 2ª
  migração (escopo v1 = landing_page).
- **Auditável**: trilha completa por watch.

### Negativas / dívidas
- **Playwright na imagem Fly** aumenta o tamanho do container (Chromium, ~170MB + libs). Instalado
  como root via `playwright install --with-deps chromium` num dir compartilhado world-readable
  (`/ms-playwright`); o script roda como o usuário `runner` com `--no-sandbox`. Memória da VM
  subiu de 1GB → **2GB** (fly.toml) pra dar folga ao Chromium headless durante a revisão.
- **Latência de narração** de ~2–3 min (cadência do tick). Aceitável p/ tarefa de 5–25 min.
- **Correlação `run_id`**: depende de `run-skill.sh` propagar um id que ligue o `agent_job` ao
  stream de `agent_events` — verificar/instrumentar (dependência da Fase 1).
- **Custo LLM por tick** (skill com visão na revisão). Baixo volume hoje; monitorar.
- **Email single-provider** (Resend) sem fallback — aceito no v1.
