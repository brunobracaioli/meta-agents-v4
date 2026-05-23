# Threat model — Fly.io Cron Campaign Runner

| Campo | Valor |
|---|---|
| Status | accepted |
| Data | 2026-05-19 |
| Owner | brunobracaioli |
| Surface | Fly Machine `meta-agents-v4` em `gru` rodando Claude Code CLI + supercronic |
| Spec | [docs/specs/flyio-cron-campaign-runner.md](../../specs/flyio-cron-campaign-runner.md) |
| ADR | [docs/adr/0001-fly-machine-supercronic.md](../../adr/0001-fly-machine-supercronic.md) |

STRIDE para a nova superfície de ataque introduzida pelo runner.

## S — Spoofing

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Atacante se passa por operador via SSH | Acesso a `flyctl ssh` | SSH só via `flyctl` autenticado contra org Fly do operador; sem porta 22 exposta; sem `[[services]]` no `fly.toml` |
| Atacante se passa por API Meta | Não aplicável | Tokens da conta Claude.ai vivem no volume; conexão a Meta via MCP autenticado pela Claude.ai, não por chave Meta exposta |
| Build do supercronic adulterado | MITM no download | SHA1 fixo (`9f27ad28...`) validado no Dockerfile via `sha1sum -c -` |

## T — Tampering

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Alguém modifica `.claude/skills/` em runtime | Acesso ao container | Imagem é built-once + copy-only; container roda como `runner` (uid 1000); SSH só do operador |
| Alguém modifica `crontab` para disparar mais vezes | Acesso ao container | Mesmo controle de acesso. crontab está em `/app/crontab` owned por `runner`. Edição precisa de novo deploy. |
| Dependência npm `@anthropic-ai/claude-code` comprometida | Supply chain | Pinar versão exata no Dockerfile (`@x.y.z`) antes de produção; revisar `npm audit` antes de subir versão; Dependabot futuro |

## R — Repudiation

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Operador alega "não fui eu que disparei" | Auditabilidade fraca | Cada run grava `/var/log/runs/<utc-ts>-<skill>.log` + linha `RUN_RESULT` em `fly logs` (retenção ~30d). Manifest da skill em `tentativas-geracao-de-campanhas/` referencia `campaign_id` Meta. |
| Histórico de quem fez seed do OAuth | Operação one-shot | Documentado no spec §7.1; quem fez `claude login` é dono dos tokens. Registro fica implícito no `fly logs` do dia do seed. |

## I — Information disclosure

| Ameaça | Vetor | Mitigação |
|---|---|---|
| `.env.local` vaza por estar embarcado na imagem | docker history / pull | `.env.local` está em `.dockerignore`; secrets vão exclusivamente via `fly secrets` (vault encrypted). |
| Logs vazam API key ou tokens | stdout do `claude -p` | Claude Code não imprime sua própria API key por padrão. Service-role key e tokens Upstash são usados apenas via MCP, não no prompt. **Atenção**: `--dangerously-skip-permissions` pode permitir que o LLM execute `printenv` ou `cat /home/runner/.claude/.credentials.json` se for instruído — porém o prompt é literal-string hardcoded (nome da skill), sem input externo controlado por usuário. Risco residual baixo. |
| Logs vazam PII do cliente final | Skill processa landing page | Skill já é projetada para não logar dados pessoais; ad copy é o que vai ao Meta. Logs ficam no volume privado da Machine, não publicados. |
| Volume `claude_state` lido por terceiros | Multi-tenant Fly | Volumes Fly são per-org + per-Machine, isolados por Firecracker; só acessíveis via SSH autenticado. |

## D — Denial of service

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Skill trava em loop infinito de tool-use | Bug ou prompt-injection | `timeout 1500` no wrapper (25 min hard cap). |
| Custo LLM explode em um único run | Tokens muitos | `WORKFLOW_LLM_BUDGET_USD_CAP=2.00` enforced pela skill. |
| Custo Meta explode em ativação acidental | Skill cria campanha com budget acima do cap | Skill já termina tudo em **PAUSED**; cap absoluto `WORKSPACE_MAX_DAILY_BUDGET_CENTS=5000` no nível workspace. Ativação só ocorre por ação humana no Ads Manager. |
| Disparos sobrepostos | Reboot durante cron | `supercronic` não overlap por default; mesmo se sobrepuser, ambos terminam PAUSED → custo Meta zero. |
| Storage do volume enche | Logs acumulando | `/var/log/runs/` cresce ~50KB/dia; 1GB inicial → ~50 anos. Reavaliar quando passar de 500MB. |

## E — Elevation of privilege

| Ameaça | Vetor | Mitigação |
|---|---|---|
| Container escapa pra host | Kernel exploit | Firecracker microVM = hardware isolation; mesmo modelo do AWS Lambda; rate de escape histórico ~zero. |
| Processo escala de `runner` pra root | setuid binaries | Container é slim, sem binaries setuid relevantes; `runner` uid 1000 sem sudo. |
| `--dangerously-skip-permissions` permite ação destrutiva | LLM age sem confirmar | **Risco real**. Mitigações em camadas: (1) prompt é hardcoded — nome da skill (literal), sem input externo; (2) skill é código revisado dentro do próprio repo; (3) container é Firecracker (escape rate extremamente baixo); (4) sem tokens Meta-level (a auth Meta é via Claude.ai connector, escopo limitado pelo connector); (5) re-avaliar antes de habilitar prompts dinâmicos vindos de fontes externas. |
| Cron dispara skill arbitrária por modificação local | Edição não-autorizada | Crontab e scripts copiados em build-time, owned por `runner`; só mudam via novo deploy autenticado. |

## Resumo de mitigações que ENTRAM no PR inicial

- `.env.local` em `.dockerignore`; secrets via `fly secrets`.
- Container roda como uid 1000 (não root).
- `tini` como PID 1.
- SHA1 do supercronic validado no build.
- `timeout 1500` no wrapper.
- Healthz que falha após 5min sem `.credentials.json`.
- Sem porta exposta (`[[services]]` ausente do `fly.toml`).
- Prompt do `claude -p` 100% hardcoded.

## A revisitar antes da próxima onda

- Trocar `--dangerously-skip-permissions` por allowlist explícita via `--allowed-tools` quando o prompt passar a receber input dinâmico.
- Adicionar `npm audit` e `gitleaks` no CI antes do `fly deploy`.
- Considerar segregar `meta-agents-v4-staging` para dry-runs antes de cada mudança de skill.
