# Tutorial — Deployando o Fly Cron Runner do zero

> **Tempo total**: 30–60 min (a maior parte é espera de build e OAuth manual).
> **Audiência**: operador fazendo o setup pela primeira vez, ou refazendo após perda do estado.
> **Resultado**: Fly Machine `meta-agents-v4` em `gru` rodando supercronic que dispara `claude -p` diariamente às 10h BRT.
>
> Para o **porquê** desta arquitetura, ver [ADR 0001](../adr/0001-fly-machine-supercronic.md).
> Para **receitas pontuais** depois do setup, ver [How-to runbook](../how-to/operations-runbook.md).
> Para **referência de arquivos/env/comandos**, ver [Reference](../reference/runner-reference.md).

---

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Instalar e logar no flyctl](#2-instalar-e-logar-no-flyctl)
3. [Validar o projeto local](#3-validar-o-projeto-local)
4. [Passo 1 — Subir secrets](#passo-1--subir-secrets)
5. [Passo 2 — Criar o volume](#passo-2--criar-o-volume)
6. [Passo 3 — Deploy da imagem](#passo-3--deploy-da-imagem)
7. [Passo 4 — Seed do OAuth do Claude.ai](#passo-4--seed-do-oauth-do-claudeai)
8. [Passo 5 — Smoke test](#passo-5--smoke-test)
9. [Passo 6 — Confirmar o cron](#passo-6--confirmar-o-cron)
10. [Critério de "pronto"](#critério-de-pronto)
11. [Apêndice A — Gotchas conhecidos](#apêndice-a--gotchas-conhecidos)

---

## 1. Pré-requisitos

### Sistema operacional

Funciona em Linux nativo, macOS ou **WSL2 (Windows)**. Este tutorial assume **WSL2 Ubuntu** porque é o ambiente do operador de referência.

Se você estiver no Windows puro, abra "Ubuntu" no Start menu. Todos os comandos abaixo são colados no terminal WSL.

### Contas necessárias

- **Conta Fly.io** com saldo positivo (ou cartão registrado). Custo estimado do runner: ~$6/mês.
- **Conta Claude.ai** (subscription Claude Max recomendada) com os connectors **Meta Ads MCP** e **Supabase MCP** já autorizados via interface da Claude.ai. Sem isso, o seed do passo 4 não vai herdar os connectors.
- **Conta OpenAI** com saldo positivo (a skill usa `gpt-image-2` pra gerar criativos).
- **Conta Supabase** (project já criado, com tabelas e Storage configurados).
- **Conta Meta Business Manager** com:
  - Business Verification completa (status "Verificado" em Business Settings → Informações da empresa)
  - **Default advertiser + payer registrados na ad account** via Ads Manager → ⚙️ Advertising Settings → Verifications and ad transparency. Sem isso, a skill falha no AdSet com `100/3858634` mesmo passando os campos DSA no payload. Ver [Runbook §18](../how-to/operations-runbook.md#18-erro-meta-1003858634-verified-advertiser-missing) pro passo-a-passo.

### Arquivos locais

Você precisa ter o repositório clonado em `/mnt/c/agents_team_meta_ads_v3` (ajuste o path se for outro), e o arquivo `.env.local` na raiz com as 23 chaves listadas em [`.env.example`](../../.env.example). Sem o `.env.local` populado, o passo 1 sobe secrets vazios e a skill roda em modo degradado.

Confere rapidamente:

```bash
cd /mnt/c/agents_team_meta_ads_v3
ls -la .env.local
```

Se imprimir um arquivo de algumas centenas de bytes ou mais, ok.

---

## 2. Instalar e logar no flyctl

### 2.1 Conferir se já está instalado

```bash
which fly && fly version
```

**Se imprimir caminho + versão** (ex: `/home/<user>/.fly/bin/fly` e `fly v0.x.xxx linux/amd64`): pule pra §2.3 (login).

**Se não imprimir nada**: prossiga pra §2.2.

### 2.2 Instalar

```bash
curl -L https://fly.io/install.sh | sh
```

Espera de 10–30s. No final, adicione o PATH ao seu shell:

```bash
echo 'export FLYCTL_INSTALL="$HOME/.fly"' >> ~/.bashrc
echo 'export PATH="$FLYCTL_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Confirme:

```bash
fly version
```

### 2.3 Login

```bash
fly auth login
```

O `flyctl` tenta abrir o browser. No WSL pode falhar — se aparecer "failed opening browser", ele imprime uma URL. Cola no browser do Windows, completa o login com a conta que tem o app `meta-agents-v4`, fecha o tab. O terminal mostra:

```
Waiting for session... Done
successfully logged in as <seu-email>
```

Valida:

```bash
fly auth whoami
```

Tem que imprimir seu email.

---

## 3. Validar o projeto local

```bash
cd /mnt/c/agents_team_meta_ads_v3
pwd                                  # /mnt/c/agents_team_meta_ads_v3
ls Dockerfile fly.toml .dockerignore crontab .env scripts/run-skill.sh
```

Todos os arquivos devem existir. Se faltar `.env.local`, **pare aqui** e popule.

### Confere se o app já existe no Fly

```bash
fly apps list | grep meta-agents-v4
```

Se aparecer uma linha com `meta-agents-v4`, ok — já existe (foi criado em deploy anterior ou via dashboard). Se não aparecer:

```bash
fly apps create meta-agents-v4 --org personal
```

---

## Passo 1 — Subir secrets

**Por quê**: a Fly Machine precisa de 23 env vars (API keys, URLs, budget caps). Não dá pra embarcar no `.env.local` da imagem — `.env.local` está em [.dockerignore](../../.dockerignore) por segurança. Tudo vai pro vault encriptado do Fly via `fly secrets`.

### Comando

Cola **exatamente** isso (1 único `fly secrets set` pra evitar N deploys consecutivos):

```bash
SECRETS_ARGS=()
while IFS='=' read -r k v; do
  k="${k%$'\r'}"
  v="${v%$'\r'}"
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  SECRETS_ARGS+=("$k=$v")
done < .env.local
fly secrets set "${SECRETS_ARGS[@]}" -a meta-agents-v4
```

> ⚠️ **Gotcha CRLF**: se o `.env.local` foi editado em Notepad/VSCode no Windows, as linhas terminam em `\r\n`. Sem o `k="${k%$'\r'}"` e `v="${v%$'\r'}"`, o `\r` vira parte do nome da chave e o Fly retorna `"\r" is not a valid secret name`. As duas linhas removem o `\r` final.

### Output esperado

```
Secrets are staged for the first deployment
```

ou, se já houver Machine rodando:

```
Release v<N> created
==> Monitoring deployment
1 desired, 1 placed, 1 healthy, 0 unhealthy
--> v<N> deployed successfully
```

### Validar

```bash
fly secrets list -a meta-agents-v4
```

Tem que imprimir uma tabela com **23 nomes** e status `Staged` (na primeira vez) ou `Deployed`. **Nunca aparece o valor** — só o nome e o digest (hash). Lista esperada das chaves: ver [Reference §2](../reference/runner-reference.md#2-env-vars).

---

## Passo 2 — Criar o volume

**Por quê**: o Claude Code CLI grava OAuth + estado dos connectors em `~/.claude/`. Sem volume persistente, esse estado some a cada deploy/restart, e o passo 4 vira eterno. O volume `claude_state` é montado em `/home/runner/.claude` dentro do container e sobrevive a tudo.

### Comando

```bash
fly volumes create claude_state --size 1 --region gru -a meta-agents-v4
```

### Diálogos interativos

O `flyctl` faz 2 perguntas:

1. `? Do you require these volumes to be encrypted (recommended)? (Y/n)` → responda **Y**.
2. `? Warning! Every volume is pinned to a specific physical host. Are you sure you want to use the volumes feature? (y/N)` → responda **y**. Aceitável porque o runner é single-tenant; HA cross-region não é requisito da onda 1 (decisão registrada no [ADR 0001 §Consequences](../adr/0001-fly-machine-supercronic.md)).

### Output esperado

```
                  ID: vol_<id>
                Name: claude_state
                 App: meta-agents-v4
              Region: gru
                Zone: <zone>
             Size GB: 1
           Encrypted: true
```

### Validar

```bash
fly volumes list -a meta-agents-v4
```

Tem que aparecer 1 linha com `claude_state`, `1GB`, `gru`, `ATTACHED VM` vazio (não tem Machine ainda).

---

## Passo 3 — Deploy da imagem

**Por quê**: builda o Dockerfile (Node 22 + supercronic + Claude Code CLI), faz push pro registry do Fly, cria a Machine, monta o volume, executa o entrypoint (que inicia o supercronic).

### Comando

```bash
fly deploy --remote-only
```

`--remote-only` significa "builda nos servidores do Fly", não localmente. Vantagens:
- Não precisa de Docker instalado no WSL.
- Cache de layers fica no Fly e re-deploys subsequentes são rápidos.
- Build acontece em x86_64 mesmo se você estiver em ARM/Mac M1.

### Tempo esperado

**3–8 minutos** na primeira vez. Re-deploys subsequentes: 1–2 min (cache).

### Output esperado (resumido)

```
==> Verifying app config
✓ Configuration is valid
==> Building image with Depot
 => [internal] load build definition from Dockerfile
 => [internal] load metadata for docker.io/library/node:22-bookworm-slim
 => [ 1/12] FROM docker.io/library/node:22-bookworm-slim
 => [ 2/12] RUN apt-get update && apt-get install -y bash curl ...
 => [ 3/12] RUN curl -fsSLo /usr/local/bin/supercronic ...
 => [ 4/12] RUN npm install -g @anthropic-ai/claude-code@latest
 => [ 5/12] RUN useradd -m -u 1001 -s /bin/bash runner ...
 ...
 => exporting to image
 => pushing layers for registry.fly.io/meta-agents-v4:deployment-...
--> Build Summary: image: registry.fly.io/meta-agents-v4:deployment-...
--> image size: ~170 MB

==> Creating release
--> release v<N> created
==> Monitoring deployment
1 desired, 1 placed, 1 healthy, 0 unhealthy
--> v<N> deployed successfully
```

**A linha que importa**: `1 desired, 1 placed, 1 healthy, 0 unhealthy`.

### Validar

```bash
fly status -a meta-agents-v4
```

Tem que mostrar 1 Machine em `state: started`, region `gru`.

### Possíveis erros nesta etapa

| Erro | Causa | Fix |
|---|---|---|
| `failed to fetch an image (status 503)` | Incidente no Fly | Espera 15 min, retry. Veja status.flyio.net |
| `failed querying for new release: invalid character '<'` | Token Fly expirado | `fly auth logout && fly auth login` |
| `UID 1000 is not unique` | Dockerfile usando UID que conflita com `node` user da base | **Já corrigido**: usamos UID 1001. Se voltar, troque para 1002 |
| `source volume "claude_state" not found` | Pulou o Passo 2 | Faça o Passo 2 |
| `0 healthy, 1 unhealthy` | Machine subiu mas algo na inicialização falhou | `fly logs -a meta-agents-v4` pra ver stack trace |

---

## Passo 4 — Seed do OAuth do Claude.ai

**Por quê**: este é o passo mais subestimado e mais crítico. Sem OAuth seedado, a skill `/create-traffic-brunobracaioli-campaign` não consegue acessar os connectors Meta Ads MCP e Supabase MCP da Claude.ai — e ela depende deles pra criar a campanha. Não dá pra automatizar (é OAuth interativo). Faz-se uma vez na vida do volume.

### 4.1 Entrar no container

```bash
fly ssh console -a meta-agents-v4
```

Você cai em um prompt:

```
Connecting to <ip>... complete
root@<machine-id>:/app#
```

Você está como **root** dentro do container, no diretório `/app`.

### 4.2 Rodar o `claude` (interativo)

```bash
claude
```

O CLI imprime um banner de boas-vindas:

```
Welcome to Claude Code v2.x.xxx
```

Depois ele tenta autenticar. Em algumas versões recentes, o CLI já se conecta automaticamente à conta Claude se ele detectar credentials embedded em outro lugar (ex: API key via env var). Em outras, ele imprime uma URL OAuth.

#### Caso A — Apareceu URL OAuth

```
Open this URL in your browser to authenticate:
  https://claude.ai/oauth/authorize?...
```

1. Copia a URL.
2. Cola no browser do Windows.
3. Faz login com a conta Claude.ai (a que tem Meta MCP autorizado).
4. Browser mostra "Authentication successful, you can close this window."
5. Volta ao terminal SSH — o `claude` confirma `✓ Authenticated as <email>`.
6. Digita `/exit` ou pressiona `Ctrl+D` pra sair do prompt interativo.

#### Caso B — Não apareceu URL (auto-auth funcionou)

O CLI já está autenticado via algum mecanismo de descoberta. Aparece direto o prompt interativo (`❯`). Apenas pressiona `Ctrl+D` ou digita `/exit` pra sair.

### 4.3 Verificar onde os tokens foram gravados

```bash
ls -la /root/.claude/
ls -la /root/.claude.json 2>/dev/null
```

Você deve ver:
- `/root/.claude/.credentials.json` (tokens OAuth)
- `/root/.claude.json` (config global do Claude Code, no home, FORA da pasta)

> ⚠️ **Gotcha**: o `claude` foi rodado como **root**, então gravou em `/root/`. Mas o cron roda como **runner**, e lê de `/home/runner/`. Precisamos copiar.

### 4.4 Copiar credenciais pro volume do runner

```bash
cp -a /root/.claude/. /home/runner/.claude/
[[ -f /root/.claude.json ]] && cp /root/.claude.json /home/runner/.claude.json
chown -R runner:runner /home/runner/.claude /home/runner/.claude.json
ls -la /home/runner/.claude/.credentials.json /home/runner/.claude.json
```

Output esperado: 2 arquivos com owner `runner:runner`.

> 💡 `cp -a` preserva permissões, symlinks e dotfiles. O `.` no fim de `/root/.claude/.` copia o **conteúdo** da pasta, não a pasta em si.

### 4.5 Sair do container

```bash
exit
```

Você volta ao terminal WSL.

---

## Passo 5 — Smoke test

**Por quê**: antes de confiar no cron amanhã às 10h BRT, você dispara a skill manualmente. Se funcionar, o cron vai funcionar igual — supercronic vai chamar o mesmo `run-skill.sh` no mesmo container.

### Comando

```bash
fly ssh console -a meta-agents-v4 -C "runuser -u runner -- /app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign"
```

> ⚠️ **Gotcha crítica**: use `runuser -u runner --`, **não** `su - runner -c`. O `su -` (com hífen) cria um shell de login limpo que apaga todas as env vars herdadas do PID 1 — a skill perde acesso a `OPENAI_API_KEY`, `SUPABASE_*`, etc. e roda em modo degradado. Veja o [How-to §rodar-skill-manualmente-em-produção](../how-to/operations-runbook.md).

### Tempo esperado

**5–15 minutos**. A skill:

1. Lê a definição do cliente em `.claude/skills/lista-de-clientes/`.
2. Faz scrape da landing page do produto.
3. Gera 3 imagens via OpenAI gpt-image-2.
4. Gera copy via subagent `copywriter`.
5. Cria Campaign + AdSet + 3 Ads no Meta Ads (tudo PAUSED).
6. Faz upload dos assets pra Supabase Storage.
7. Grava manifest em `tentativas-geracao-de-campanhas/<ts>-trafego.json`.

### Output esperado (resumido)

```
RUN_START skill=create-traffic-brunobracaioli-campaign log=/var/log/runs/<ts>-create-traffic-brunobracaioli-campaign.log ts=<ts> timeout=1500s

[saída da skill — pode ser longa]

| Camada | ID | Status |
|---|---|---|
| Campaign | <id> | PAUSED |
| AdSet | <id> | PAUSED |
| Ad v1 | <id> | PAUSED |
| Ad v2 | <id> | PAUSED |
| Ad v3 | <id> | PAUSED |

RUN_RESULT skill=create-traffic-brunobracaioli-campaign exit=0 log=/var/log/runs/<ts>-...log
```

### Validar no Meta Ads Manager

Abre no browser:

```
https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661
```

Procura por uma campanha **PAUSED** com nome começando em `[TRF][CCA][<data>]`.

### Possíveis "falhas parciais" (skill volta exit=0)

A skill é resiliente: termina com `exit=0` mesmo com bloqueios externos, gravando-os no manifest. Os bloqueios possíveis são externos ao código:

| Erro | Causa | Como resolver |
|---|---|---|
| OpenAI `billing_hard_limit_reached` | Saldo insuficiente | Top up em https://platform.openai.com/account/billing |
| Meta `100/3858634 verified advertiser missing` | Falta default advertiser/payer registrado na ad account (setup UI-only, uma vez por conta). Campos DSA no payload são prerequisite mas não suficientes. | Ads Manager → ⚙️ Advertising Settings → Verifications and ad transparency → "Add advertiser and payer". Ver [Runbook §18](../how-to/operations-runbook.md#18-erro-meta-1003858634-verified-advertiser-missing) |
| Supabase Storage 401 | Service role key errada | Refaça o Passo 1 com `.env.local` correto |

Se a skill voltar com `exit=0` mas o Ads Manager mostrar só Campaign (sem AdSet/Ads), o problema é externo. Resolve no Meta/OpenAI e roda de novo.

---

## Passo 6 — Confirmar o cron

### 6.1 Conferir que a Machine está viva

```bash
fly status -a meta-agents-v4
```

`state: started`.

### 6.2 Acompanhar logs em tempo real

```bash
fly logs -a meta-agents-v4
```

Você vai ver linhas tipo:

```
time="..." level=info msg="starting iteration" iteration=N
```

a cada ~60s do supercronic. **Não tem job rodando** entre 10h BRT — supercronic só dispara o `run-skill.sh` na hora marcada.

Pressiona `Ctrl+C` pra fechar.

### 6.3 Esperar 10h BRT do dia seguinte

No dia seguinte às 10h BRT, abra `fly logs -a meta-agents-v4` e observe:

```
time="..." level=info msg="starting" job.command="/app/scripts/run-skill.sh create-traffic-brunobracaioli-campaign" job.schedule="0 10 * * *"
RUN_START skill=create-traffic-brunobracaioli-campaign log=/var/log/runs/...
[ output da skill ]
RUN_RESULT skill=create-traffic-brunobracaioli-campaign exit=0 log=...
time="..." level=info msg="job succeeded"
```

Validação final: nova campanha PAUSED visível no Ads Manager.

---

## Critério de "pronto"

Você considera o deploy **completo** quando:

- [x] `fly status -a meta-agents-v4` mostra 1 Machine `started` em `gru`.
- [x] `fly secrets list -a meta-agents-v4` mostra 23 secrets `Deployed`.
- [x] `fly volumes list -a meta-agents-v4` mostra 1 volume `claude_state` attached à Machine.
- [x] `/home/runner/.claude/.credentials.json` existe no container.
- [x] Smoke test do passo 5 retornou `exit=0`.
- [x] Pelo menos uma execução automática do cron foi observada via `fly logs`.

Se algum desses falhar, volte ao passo correspondente.

---

## Apêndice A — Gotchas conhecidos

Resumo de todas as armadilhas que detectamos em 2026-05-22 durante o primeiro deploy. Se você bater em algum, NÃO entre em pânico — está aqui:

### A.1 Fly remote builder devolve `503 Service Unavailable`

**Sintoma**:
```
Error: failed to fetch an image or build from source: failed to get organization <org> (status 503): <html><body><h1>503 Service Unavailable</h1>
```

**Causa**: incidente público da Fly.io. Não é nada no seu projeto.

**Fix**: confere https://status.flyio.net/, espera 15–90 min, retry `fly deploy --remote-only`.

### A.2 `UID is not unique` no Dockerfile

**Sintoma**:
```
useradd: UID 1000 is not unique
```

**Causa**: a base `node:22-bookworm-slim` já tem um user `node` em UID 1000.

**Fix**: o Dockerfile usa **UID 1001**. Se mudar a base e voltar o conflito, troque pra 1002.

### A.3 `.env.local` com line endings CRLF (Windows)

**Sintoma**:
```
Error: update secrets: "\r" is not a valid secret name
```

**Causa**: o `.env.local` foi editado em Notepad/VSCode no Windows e as linhas terminam em `\r\n`.

**Fix**: o loop do passo 1 já faz `k="${k%$'\r'}"` e `v="${v%$'\r'}"`. Garante que essas linhas estão no script colado.

### A.4 Token Fly inválido / discharge token missing

**Sintoma**:
```
Error: verify: invalid token: ... missing third-party discharge token
```

**Causa**: sessão `flyctl` expirada ou instabilidade na auth deles.

**Fix**:
```bash
fly auth logout
fly auth login
```

### A.5 `[[checks]] type=exec` inválido no `fly.toml`

**Sintoma** (apareceu durante o desenvolvimento, **já está corrigido** no `fly.toml` do repo):
```
Can't process top level check 'healthz': Missing or invalid check type, must be 'http' or 'tcp'
```

**Causa**: o schema do Fly só aceita `http`/`tcp` em `[[checks]]` top-level. `exec` só funciona dentro de `[[services.checks]]`, e o runner não tem service.

**Fix aplicado**: removemos o bloco `[[checks]]` do `fly.toml`. A liveness fica por conta de tini + supercronic (se supercronic morre, Machine reinicia). Health check manual: `/app/scripts/healthz.sh`.

### A.6 `--dangerously-skip-permissions` bloqueado como root

**Sintoma**:
```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

**Causa**: o Claude Code CLI bloqueia essa flag pra root como segurança.

**Fix**: sempre rode como `runner` via `runuser -u runner -- claude -p ...` ou via o wrapper `/app/scripts/run-skill.sh`. O cron já roda como `runner` porque o Dockerfile tem `USER runner`.

### A.7 `su - runner -c` apaga env vars do PID 1

**Sintoma**: skill roda mas reclama de `OPENAI_API_KEY` ou `SUPABASE_*` faltando, mesmo com `fly secrets list` mostrando elas.

**Causa**: o `-` em `su -` cria um shell de login isolado que apaga todas as env vars herdadas.

**Fix**: use `runuser -u runner -- <comando>` ou `su runner -mc '<comando>'` (sem hífen, com `-m`). Em produção via cron isso não acontece porque o supercronic já roda como `runner`.

### A.8 OAuth gravado em `/root/.claude/` em vez de `/home/runner/.claude/`

**Sintoma**: skill retorna `exit=3` com `Claude OAuth not seeded`.

**Causa**: você rodou `claude` interativo dentro do SSH como root (default), então tokens foram pra `/root/`. Mas o cron lê de `/home/runner/`.

**Fix**: faça o `cp -a /root/.claude/. /home/runner/.claude/` + `chown` (passo 4.4 deste tutorial). Próxima vez, pode tentar `su - runner` antes de rodar `claude` (não é garantido que funcione — depende do CLI auto-detectar a sessão).

### A.9 `/home/runner/.claude.json` (config global) ausente

**Sintoma**:
```
Claude configuration file not found at: /home/runner/.claude.json
A backup file exists at: /home/runner/.claude/backups/.claude.json.backup.<ts>
```

**Causa**: o Claude Code mantém dois locais de estado:
- `~/.claude/` (pasta) — credenciais, histórico, projetos, sessões.
- `~/.claude.json` (arquivo no home, FORA da pasta) — config global.

O passo 4.4 do tutorial copia ambos. Se você esqueceu o segundo:

```bash
cp /home/runner/.claude/backups/.claude.json.backup.<timestamp> /home/runner/.claude.json
chown runner:runner /home/runner/.claude.json
```

Em algumas execuções, o próprio Claude Code restaura o backup automaticamente — mas garantir é melhor.

---

## Próximos passos

- Para tarefas pontuais (rodar skill manual, rotacionar OAuth, atualizar CLI): ver [How-to runbook](../how-to/operations-runbook.md).
- Para referência de arquivos, env vars, exit codes: ver [Reference](../reference/runner-reference.md).
- Para entender por que essa arquitetura: ver [ADR 0001](../adr/0001-fly-machine-supercronic.md).
- Para verificar mitigações de segurança: ver [Threat model](../security/threats/flyio-runner.md).
- Para abrir onda 2 (multi-cliente, mais skills no cron): abrir nova spec em `docs/specs/`.
