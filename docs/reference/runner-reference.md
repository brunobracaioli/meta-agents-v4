# Reference — Fly Cron Runner

> **Audiência**: operador procurando "qual era mesmo o nome daquele path?". Formato: tabelas, sem narrativa.
> **Para entender**: ver [ADR 0001](../adr/0001-fly-machine-supercronic.md). **Para fazer**: ver [Tutorial](../tutorials/deploying-fly-runner-from-scratch.md) ou [How-to](../how-to/operations-runbook.md).

---

## Sumário

1. [Arquivos do projeto](#1-arquivos-do-projeto)
2. [Env vars](#2-env-vars)
3. [Exit codes do `run-skill.sh`](#3-exit-codes-do-run-skillsh)
4. [Paths dentro do container](#4-paths-dentro-do-container)
5. [Comandos flyctl](#5-comandos-flyctl)
6. [Endpoints externos](#6-endpoints-externos)
7. [IDs do cliente brunobracaioli](#7-ids-do-cliente-brunobracaioli)
8. [Versões pinadas](#8-versões-pinadas)
9. [Recursos Fly provisionados](#9-recursos-fly-provisionados)

---

## 1. Arquivos do projeto

| Caminho | Propósito | Quem lê |
|---|---|---|
| `Dockerfile` | Build da imagem (node:22 + supercronic + claude-code + runner user) | Fly Depot builder |
| `fly.toml` | Config Fly (app, region, volume, vm size) | flyctl + Fly platform |
| `.dockerignore` | Exclui `.env.local`, `venv/`, generated assets do build context | docker build |
| `crontab` | Entradas supercronic (1x/dia 10h BRT) | supercronic dentro do container |
| `scripts/entrypoint.sh` | PID 1 do container; exec supercronic | Container ENTRYPOINT |
| `scripts/run-skill.sh` | Wrapper minimal do `claude -p`; valida + timeout + log | supercronic |
| `scripts/healthz.sh` | Diagnóstico manual (claude --version + crontab + OAuth) | Operador via SSH |
| `.env.local` | Secrets locais (gitignored) | Loop bash em deploy |
| `.env.example` | Documenta nomes das env vars sem valores | Operador |

## 2. Env vars

Todas vão via `fly secrets`. Nunca embarcadas na imagem.

| Nome | Origem (`.env.local`) | Usado por | Obrigatório? |
|---|---|---|---|
| `CLAUDE_API_KEY` | mesma | Anthropic SDK (fallback se OAuth do CLI falhar) | Sim |
| `OPENAI_API_KEY` | mesma | `/image-generate` (gpt-image-2) | Sim |
| `SUPABASE_URL` | mesma | MCP + persistência | Sim |
| `SUPABASE_ANON_KEY` | mesma | Tools client-side dentro de skills | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | mesma | MCP server-side, Storage upload | Sim |
| `NEXT_PUBLIC_SUPABASE_URL` | mesma | Compat com tools que esperam Next env | Sim |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | mesma | Idem | Sim |
| `DATABASE_URL` | mesma | Conexão direta Postgres (raro) | Sim |
| `UPSTASH_REDIS_REST_URL` | mesma | Cache + rate-limit | Sim |
| `UPSTASH_REDIS_REST_TOKEN` | mesma | Auth Upstash | Sim |
| `QSTASH_TOKEN` | mesma | Queue (legacy, mantido) | Sim |
| `QSTASH_CURRENT_SIGNING_KEY` | mesma | Verify QStash callbacks | Sim |
| `QSTASH_NEXT_SIGNING_KEY` | mesma | Idem | Sim |
| `PIXELLAB_API_KEY` | mesma | Image tooling | Sim |
| `WORKSPACE_MAX_DAILY_BUDGET_CENTS` | `=5000` | Cap absoluto Meta (R$ 50/dia) | Sim |
| `WORKFLOW_LLM_BUDGET_USD_CAP` | `=2.00` | Cap LLM por run | Sim |
| `WORKFLOW_SPAWNER` | `=local` | Modo de spawn de workflow | Sim |
| `OPERATOR_AUTO_START` | `=false` | Flag de auto-start (legacy) | Sim |
| `OPERATOR_USER_ID` | mesma | ID interno do operador | Sim |
| `OPERATOR_WORKSPACE_ID` | mesma | ID do workspace | Sim |
| `HOOK_SECRET` | mesma | Webhook signing | Sim |
| `APP_URL` | mesma | URL pública (não-usada pelo runner; legacy) | Sim |
| `DASHBOARD_PASSWORD` | mesma | Senha dashboard (não-usada pelo runner; legacy) | Sim |

Total: **23 secrets**. Confirma com:

```bash
fly secrets list -a meta-agents-v4 | wc -l   # 23 + linhas de cabeçalho
```

> `TZ=America/Sao_Paulo` e `LOG_LEVEL=info` vêm de `[env]` no `fly.toml` (não-sensíveis, podem ficar em config).

## 3. Exit codes do `run-skill.sh`

| Code | Significado | Ação | Receita |
|---|---|---|---|
| `0` | Skill terminou conforme contrato (pode ter bloqueios externos documentados em manifest) | Inspecionar manifest pra confirmar `verified: true` | [How-to §21](../how-to/operations-runbook.md#21-skill-exit0-mas-ads-manager-vazio) |
| `2` | Skill não encontrada em `/app/.claude/skills/<slug>/SKILL.md` | Confere slug + se a skill está no `.claude/skills/` | — |
| `3` | `/home/runner/.claude/.credentials.json` ausente | Reseed OAuth | [How-to §11](../how-to/operations-runbook.md#11-rotacionar--reseedar-oauth-do-claudeai) |
| `124` | Timeout do `timeout 1500` atingido (skill travou ≥ 25 min) | Investiga log, identifica etapa travada | [How-to §17](../how-to/operations-runbook.md#17-skill-retorna-exit124) |
| outros | Exit code propagado de `claude -p` ou tool MCP | Inspecionar log | — |

## 4. Paths dentro do container

| Caminho | Dono | Propósito | Persiste? |
|---|---|---|---|
| `/app` | `runner:runner` | Working directory; conteúdo do repo (`.claude/`, `docs/`, `CLAUDE.md`, `scripts/`, `crontab`) | Não (imagem) |
| `/app/.claude/skills/<slug>/SKILL.md` | `runner:runner` | Skills disponíveis | Não (imagem) |
| `/app/.claude/materiais-das-empresas/` | `runner:runner` | Assets dos clientes (logos, exemplos) | Não (imagem) |
| `/app/scripts/run-skill.sh` | `runner:runner` | Wrapper invocado pelo cron | Não (imagem) |
| `/app/crontab` | `runner:runner` | Definição supercronic | Não (imagem) |
| `/app/tentativas-geracao-de-campanhas/` | `runner:runner` | Manifests JSON das runs | **Não** (imagem; manifest persiste só se for re-copiado pra `/var/log/runs/` ou Supabase Storage) |
| `/var/log/runs/` | `runner:runner` | Logs `tee`'d das execuções | Não (volume não está montado aqui — está em `/home/runner/.claude/`) |
| `/home/runner/.claude/` | `runner:runner` | OAuth + connectors Claude.ai + projects + sessions + cache | **Sim** (volume `claude_state`) |
| `/home/runner/.claude/.credentials.json` | `runner:runner` | Tokens OAuth da conta Claude.ai | **Sim** |
| `/home/runner/.claude.json` | `runner:runner` | Config global do Claude Code (FORA da pasta `.claude/`) | **Sim** (mesmo volume; está sob `/home/runner/` que é a raiz do volume) |
| `/root/.claude/` | `root:root` | Estado do Claude Code rodado como root (raro; só durante seed inicial) | Não |
| `/usr/local/bin/claude` | `root:root` | Binário Claude Code CLI | Não (imagem) |
| `/usr/local/bin/supercronic` | `root:root` | Binário supercronic | Não (imagem) |

> ⚠️ `/var/log/runs/` **não** está dentro do volume mount em `/home/runner/.claude/`. Logs sobrevivem a restart de Machine, mas **não** a redeploy (imagem nova substitui). Pra retenção longa, usar `fly logs` ou subir pro Supabase Storage.

## 5. Comandos flyctl

| Comando | Quando usar | Receita |
|---|---|---|
| `fly deploy --remote-only` | Builda imagem nova + sobe | [Tutorial §3 do Passo 3](../tutorials/deploying-fly-runner-from-scratch.md#passo-3--deploy-da-imagem) |
| `fly deploy --remote-only --no-cache` | Força rebuild completo | [How-to §10](../how-to/operations-runbook.md#10-re-deploy-forçando-rebuild-sem-cache) |
| `fly secrets list -a <app>` | Lista nomes dos secrets (sem valores) | — |
| `fly secrets set K=V [-a <app>]` | Define/atualiza 1 secret (dispara deploy) | [How-to §8](../how-to/operations-runbook.md#8-atualizar-1-secret-específico) |
| `fly volumes create <name> --size <GB> --region <r>` | Cria volume persistente | [Tutorial Passo 2](../tutorials/deploying-fly-runner-from-scratch.md#passo-2--criar-o-volume) |
| `fly volumes list -a <app>` | Lista volumes da app | — |
| `fly volumes destroy <id>` | **Destrutivo**: apaga volume | [How-to §12](../how-to/operations-runbook.md#12-reseed-completo-do-volume-catástrofe) |
| `fly ssh console -a <app>` | Shell interativa dentro da Machine | [Tutorial Passo 4](../tutorials/deploying-fly-runner-from-scratch.md#passo-4--seed-do-oauth-do-claudeai) |
| `fly ssh console -a <app> -C "<cmd>"` | Executa 1 comando e sai (não-interativo) | [How-to §1](../how-to/operations-runbook.md#1-rodar-uma-skill-manualmente-em-produção) |
| `fly logs -a <app>` | Logs em tempo real (Ctrl+C pra sair) | [How-to §4](../how-to/operations-runbook.md#4-inspecionar-logs-de-uma-run-específica) |
| `fly logs -a <app> --since 1h` | Logs da última 1h | — |
| `fly status -a <app>` | Estado Machine + checks | [Tutorial Passo 6.1](../tutorials/deploying-fly-runner-from-scratch.md#61-conferir-que-a-machine-está-viva) |
| `fly releases -a <app>` | Lista deploys; útil pra rollback | [How-to §13](../how-to/operations-runbook.md#13-rollback-para-deploy-anterior) |
| `fly machine list -a <app>` | Lista Machines (geralmente 1) | — |
| `fly machine restart <id>` | Reinicia Machine sem redeploy | [How-to §20](../how-to/operations-runbook.md#20-cron-não-disparou-no-horário-esperado) |
| `fly machine update <id> --image <tag>` | Atualiza imagem da Machine (rollback) | [How-to §13](../how-to/operations-runbook.md#13-rollback-para-deploy-anterior) |
| `fly auth login` | Login OAuth | [Tutorial §2.3](../tutorials/deploying-fly-runner-from-scratch.md#23-login) |
| `fly auth whoami` | Confirma usuário logado | — |
| `fly apps list` | Lista apps da org | — |
| `fly apps create <name> --org <org>` | Cria app | [Tutorial §3](../tutorials/deploying-fly-runner-from-scratch.md#confere-se-o-app-já-existe-no-fly) |

## 6. Endpoints externos

| URL | Propósito |
|---|---|
| `https://fly.io/apps/meta-agents-v4` | Dashboard do app (deploys, logs, métricas) |
| `https://fly.io/apps/meta-agents-v4/monitoring` | Painel ao vivo de deploy |
| `https://status.flyio.net/` | Status público do Fly (incidentes) |
| `https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661` | Ads Manager do cliente brunobracaioli |
| `https://business.facebook.com/settings` | Business Settings (verificações da BM, razão social usada em `dsa_beneficiary`/`dsa_payor`) |
| `https://platform.openai.com/account/billing` | Saldo + limites OpenAI |
| `https://supabase.com/dashboard/project/<ref>` | Supabase dashboard |
| `https://claude.ai/` | Conta Claude.ai (gerencia connectors MCP) |
| `https://github.com/aptible/supercronic/releases` | Releases supercronic (SHA1 dos binários) |

## 7. IDs do cliente brunobracaioli

Fonte de verdade: `.claude/skills/lista-de-clientes/SKILL.md`.

| Campo | Valor |
|---|---|
| Business Manager | `772813643612039` |
| Ad Account | `225179730538661` (alias: `act_225179730538661`) |
| Page | `867347659802006` |
| Budget cap diário/campanha | R$ 50 = `5000` cents |
| Naming convention de campanhas | `[TRF][CCA][YYYY-MM-DD] <titulo>` |
| Landing page padrão | (consultar `lista-de-clientes`) |

## 8. Versões pinadas

| Componente | Versão | Onde |
|---|---|---|
| Base image | `node:22-bookworm-slim` | `Dockerfile` |
| supercronic | `v0.2.30` | `Dockerfile` (ARG `SUPERCRONIC_VERSION`) |
| supercronic SHA1 | `9f27ad28c5c57cd133325b2a66bba69ba2235799` | `Dockerfile` (ARG `SUPERCRONIC_SHA1SUM`) |
| Claude Code CLI | `latest` (pinar próxima revisão) | `Dockerfile` (ARG `CLAUDE_CODE_VERSION`) |
| Timezone container | `America/Sao_Paulo` | `Dockerfile` ENV + `fly.toml` [env] |
| Runner UID | `1001` | `Dockerfile` `useradd -u` |

## 9. Recursos Fly provisionados

Estado em produção no momento do primeiro deploy (2026-05-22):

| Recurso | Identificador / valor |
|---|---|
| App | `meta-agents-v4` |
| Region | `gru` (São Paulo) |
| Primary org | `nome-do-cliente` (personal) |
| Volume name | `claude_state` |
| Volume ID | `vol_r6881me0xjq00ld4` |
| Volume size | 1 GB |
| Volume encrypted | true |
| Volume zone | `ac74` |
| VM size | `shared-cpu-2x` |
| VM memory | 1024 MB |
| VM CPUs | 2 |
| Auto stop | desabilitado (cron precisa de always-on) |
| Auto start | desabilitado |
| Machine ID | `1850927a262e48` |
| Custo estimado/mês | ~$6 USD (VM always-on + 1GB volume) |
| Cron schedule | `0 10 * * *` (10h BRT diário) |
| Hard timeout por run | 1500s (25 min) |

> Esses valores podem mudar com tempo. Para o estado **atual**, sempre consulta `fly status` + `fly volumes list` + `fly machine list`.
