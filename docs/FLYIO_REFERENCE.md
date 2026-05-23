# Fly.io — Documento de Referência Completo

> **Status**: referência viva, baseada em consulta direta à documentação oficial em `https://fly.io/docs/`.
> **Última atualização**: 2026-05-12.
> **Uso**: orientar decisões de plataforma quando avaliarmos Fly.io como alternativa/complemento ao GCP (Cloud Run + Cloud SQL) atualmente usado pelo CIE.
> Onde detectei ambiguidade ou desatualização entre páginas oficiais, sinalizo com **[Atenção]**.

---

## Índice

1. [O que é Fly.io](#1-o-que-é-flyio)
2. [Arquitetura](#2-arquitetura)
3. [Setup inicial](#3-setup-inicial)
4. [Deploy de aplicações](#4-deploy-de-aplicações)
5. [Fly Machines](#5-fly-machines)
6. [Networking](#6-networking)
7. [Persistência](#7-persistência)
8. [Secrets e config](#8-secrets-e-config)
9. [Observabilidade](#9-observabilidade)
10. [Scaling](#10-scaling)
11. [Regions](#11-regions)
12. [Multi-region](#12-multi-region)
13. [CI/CD](#13-cicd)
14. [Pricing (atual em 2026)](#14-pricing-atual-em-2026)
15. [Casos de uso típicos](#15-casos-de-uso-típicos)
16. [Segurança](#16-segurança)
17. [CLI cheat sheet](#17-cli-cheat-sheet)
18. [Limitações conhecidas e armadilhas](#18-limitações-conhecidas-e-armadilhas)
19. [URLs consultadas](#urls-consultadas)

---

## 1. O que é Fly.io

Fly.io é uma plataforma de deploy e execução de aplicações em escala global, construída sobre **microVMs Firecracker** (mesma tecnologia do AWS Lambda) — com modelo de cobrança por segundo e foco em latência baixa via **anycast** + presença em múltiplas regiões.

### Diferenciais

- **Firecracker microVMs**: cada workload roda em uma micro-VM com hardware isolation real (não containers compartilhando kernel). Boot subsegundo.
- **Edge global por padrão**: 18 regiões em produção (Américas, Europa, Ásia-Pacífico, África). IP anycast único roteia para a região mais próxima.
- **Fly Proxy**: load balancer global L4/L7 que termina TLS, faz roteamento por header (ex: `fly-replay`, `fly-prefer-region`), aplica autostart/autostop.
- **Modelo "VM-first"**: você pensa em termos de Machines (VMs persistentes), não funções serverless. Permite stateful workloads (Postgres, Redis, sockets, queues longas) que serverless tradicional não cobre.
- **Per-second billing**: paga apenas pelo tempo que a Machine está `started`. Stopped/suspended Machines cobram só storage do rootfs.

### Comparação rápida

| Plataforma | Modelo | Stateful | Cold start | Edge global | Free tier |
|---|---|---|---|---|---|
| **Fly.io** | microVM persistente | Sim (volumes, MPG) | ~300ms-1s (autostart) | 18 regiões anycast | Não (após 2024) |
| **Cloud Run** | Container serverless | Não (volumes limitados) | ~100ms-2s | Multi-região via LB | 2M req/mês |
| **Render** | Container PaaS | Sim (disks) | Sim (free tier dorme) | Single-region por serviço | Sim (com sleep) |
| **Heroku** | Buildpack PaaS | Add-ons | Sim (eco dyno) | Single-region (US/EU) | Não |
| **Railway** | Container PaaS | Volumes | ~segundos | Multi-region beta | Trial $5 |

Fly se diferencia por: **isolamento de microVM real** (vs. containers), **stateful nativo com volumes NVMe locais**, e **anycast verdadeiro** (1 IP, múltiplas regiões).

> **Comparação contextual com o CIE**: o stack atual roda em Cloud Run (`api-main`, `worker-*`, frontend) com Cloud SQL Postgres, Cloud Tasks, Secret Manager, GCS. Migrar para Fly trocaria: Cloud Run → Fly Machines (com `auto_start_machines`); Cloud SQL → Managed Postgres (MPG); Cloud Tasks → fila própria (Litequeue/Postgres) ou um Machine sempre-on rodando worker; Secret Manager → `fly secrets`; GCS → Tigris (S3-compatible). BigQuery não tem equivalente — exigiria continuar no GCP ou trocar de warehouse.

---

## 2. Arquitetura

### Hierarquia de objetos

```
Organization (billing + RBAC + 6PN privado)
└── App (unidade lógica, 1 nome de host *.fly.dev)
    ├── Machines (VMs Firecracker, 1+ por app)
    ├── Volumes (NVMe persistente, 1:1 com Machine)
    ├── IPs (shared/dedicated, v4/v6, anycast)
    └── Secrets (vault encrypted)
```

### Fly Machines

Cada Machine é uma microVM Firecracker com:

- Imagem Docker (OCI) baixada no boot
- CPU presets: `shared-cpu-1x/2x/4x/8x` (econômico, com burst) ou `performance-1x...16x` (dedicado)
- Arquiteturas: **x86_64** (default) ou **ARM (a1000)**
- Memória: 256MB até 256GB
- API REST nativa: **Fly Machines API** — você pode criar, parar, destruir, hot-update via HTTP

### Boot process

1. Fly Proxy recebe request → identifica app/region
2. Se Machine `stopped` e `auto_start_machines=true`: envia start signal
3. Firecracker inicia microVM (~300ms para shared-cpu-1x)
4. Container image já cacheada no host → mount → exec entrypoint
5. Health checks rodam (`smoke checks` ~10s)
6. Proxy começa a rotear tráfego

### Billing model

- **Per-second**, não per-request
- Apenas Machines em estado `started` cobram CPU/RAM
- `stopped` cobra só rootfs ($0.15/GB/mês)
- `suspended` (estado intermediário, mais rápido pra acordar): cobra RAM
- Volumes cobram capacidade provisionada (não usada)
- Egress de rede cobrado por GB, varia por região

URLs: `https://fly.io/docs/machines/`, `https://fly.io/docs/machines/cpu-performance/`

---

## 3. Setup inicial

### Instalação flyctl

**Linux**

```bash
curl -L https://fly.io/install.sh | sh
```

**macOS**

```bash
brew install flyctl
# ou
curl -L https://fly.io/install.sh | sh
```

**Windows (PowerShell)**

```powershell
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

**WSL**: usar o comando Linux dentro do WSL. Após instalar, adicionar ao `~/.bashrc` ou `~/.zshrc`:

```bash
export FLYCTL_INSTALL="/home/$USER/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
```

### Conta e auth

```bash
fly auth signup      # cria conta nova
fly auth login       # login interativo (abre browser)
fly auth whoami      # confirma identidade
fly auth token       # exibe API token atual
```

### Organização e billing

```bash
fly orgs list                    # listar orgs
fly orgs create <name>           # nova org
fly orgs invite <email>          # convidar membro
fly dashboard                    # abre dashboard web (billing, faturas)
```

Billing é configurado pelo dashboard web — cartão de crédito obrigatório desde 2024 (free tier descontinuado).

URLs: `https://fly.io/docs/flyctl/install/`, `https://fly.io/docs/getting-started/`

---

## 4. Deploy de aplicações

### `fly launch` — bootstrap

Detecta framework automaticamente (Next.js, Rails, Django, Flask, FastAPI, Phoenix, Go, Rust, etc) e gera `fly.toml` + Dockerfile.

```bash
fly launch                       # interativo
fly launch --no-deploy           # gera config sem deploy
fly launch --copy-config         # reusa fly.toml existente
fly launch --org <name>          # define org
fly launch --region gru          # primary region
fly launch --flycast             # app privada (sem IP público)
```

### `fly.toml` — anatomia completa

```toml
# Identidade
app = "my-app"
primary_region = "gru"

# Build
[build]
  dockerfile = "Dockerfile"
  # OU buildpack:
  # builder = "paketobuildpacks/builder:base"
  # OU nixpacks (autodetect padrão se sem Dockerfile)

  [build.args]
    NODE_VERSION = "22"

# Env vars (não-sensíveis, ficam em plaintext no fly.toml)
[env]
  PORT = "8080"
  LOG_LEVEL = "info"

# HTTP service simplificado (porta 80/443)
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"      # "off" | "stop" | "suspend"
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]

  [http_service.concurrency]
    type = "requests"              # ou "connections"
    soft_limit = 200
    hard_limit = 250

  [[http_service.checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
    method = "GET"
    path = "/health"

# Services low-level (TCP/UDP custom)
[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

# Recursos da VM
[[vm]]
  size = "shared-cpu-1x"           # ou cpu_kind/cpus separados
  memory = "512mb"
  cpu_kind = "shared"              # "shared" | "performance"
  cpus = 1
  # processes = ["worker"]         # vincula vm preset a um process group

# Volumes persistentes
[[mounts]]
  source = "data"
  destination = "/data"
  initial_size = "10gb"
  auto_extend_size_threshold = 80  # %, para auto-grow
  auto_extend_size_increment = "5gb"
  auto_extend_size_limit = "100gb"

# Process groups (multi-process apps)
[processes]
  app = "node server.js"
  worker = "node worker.js"

# Deploy
[deploy]
  strategy = "rolling"             # "rolling" | "bluegreen" | "canary" | "immediate"
  release_command = "npm run migrate"
  release_command_vm = { size = "shared-cpu-2x", memory = "1gb" }

# Static files
[[statics]]
  guest_path = "/app/public"
  url_prefix = "/static"

# Health checks independentes (não afetam roteamento)
[checks]
  [checks.deep]
    type = "http"
    port = 8080
    path = "/health/deep"
    interval = "60s"
    timeout = "10s"

# Files: secrets injetados como arquivo
[[files]]
  guest_path = "/etc/cert.pem"
  secret_name = "TLS_CERT_B64"
```

### Build options

| Mecanismo | Quando usar |
|---|---|
| **Dockerfile** | Controle total. Default se `Dockerfile` existe no repo. |
| **Buildpacks (Paketo)** | App padrão sem Dockerfile, set `builder = "..."` em `[build]`. |
| **Nixpacks** | Autodetect quando não há Dockerfile. Detecta Node/Python/Go/Rust. |

### `fly deploy`

```bash
fly deploy                                # build + push + deploy
fly deploy --remote-only                  # build em Fly Builder (não usa Docker local)
fly deploy --local-only                   # força build no host local
fly deploy --strategy bluegreen           # override strategy
fly deploy --image registry.fly.io/myapp:v3   # rollback / image específica
fly deploy --image-label v3               # tag customizada
fly deploy --no-cache                     # invalida cache do build
fly deploy --build-arg NODE_VERSION=22    # build args ad-hoc
fly deploy --wait-timeout 300             # timeout em segundos
fly deploy --ha=false                     # 1 machine só (sem HA pair)
```

### Deploy strategies

- **`rolling`** (default): atualiza uma Machine por vez, espera health check antes da próxima.
- **`immediate`**: derruba todas e atualiza em paralelo. Causa downtime mas mais rápido.
- **`canary`**: cria uma Machine nova, valida, e só então faz rolling no resto.
- **`bluegreen`**: cria conjunto novo paralelo, migra tráfego só quando todos passam health check. **Requer múltiplas Machines** (não funciona com 1 Machine só).

### Releases e rollback

```bash
fly releases                              # histórico de releases
fly releases --image                      # mostra image refs
fly deploy --image <image-ref>            # rollback para image antiga
fly status                                # estado atual + último deploy
```

URLs: `https://fly.io/docs/launch/deploy/`, `https://fly.io/docs/reference/configuration/`

---

## 5. Fly Machines

Machines são primitivas — `fly deploy` é uma orquestração sobre elas. Você pode também manipular diretamente.

```bash
fly machine list                          # listar Machines
fly machine status <id>                   # detalhes de 1 Machine
fly machine run <image> [cmd]             # criar + iniciar
fly machine create <image>                # criar sem iniciar
fly machine start <id>
fly machine stop <id>                     # graceful stop
fly machine suspend <id>                  # snapshot RAM (acorda mais rápido)
fly machine restart <id>
fly machine destroy <id>                  # delete permanente (--force se started)
fly machine clone <id>                    # cópia idêntica
fly machine update <id> --image <new>     # atualiza in-place
fly machine cordon <id>                   # remove do load balancer
fly machine uncordon <id>
```

### `fly machine run` exemplo

```bash
fly machine run nginx:latest \
  --app my-app \
  --region gru \
  --name web-1 \
  --port 80/tcp:http \
  --port 443/tcp:tls:http \
  --env LOG_LEVEL=debug \
  --restart always \
  --volume data:/data \
  --vm-size shared-cpu-2x \
  --vm-memory 1024
```

### Auto start / stop / suspend

Configurável em `[http_service]` ou `[[services]]` no `fly.toml`:

```toml
[http_service]
  internal_port = 8080
  auto_stop_machines = "stop"      # "off" | "stop" | "suspend"
  auto_start_machines = true
  min_machines_running = 0
```

- **`auto_stop_machines = "off"`**: nunca para. Bom para workers / background.
- **`auto_stop_machines = "stop"`**: para Machines ociosas. Cold start ~1-3s no próximo request.
- **`auto_stop_machines = "suspend"`**: snapshot da RAM em disco. Wake-up ~300ms-1s. **Caveats**: nem toda imagem suporta (precisa de kernel compatível); cobra RAM enquanto suspended.
- **`min_machines_running`**: mínimo na **primary region** (não conta outras regiões). Default 0 = full scale-to-zero.

**Recomendação oficial**: manter `auto_stop_machines` e `auto_start_machines` consistentes (ambos on ou ambos off).

URLs: `https://fly.io/docs/machines/`, `https://fly.io/docs/launch/autostop-autostart/`

---

## 6. Networking

### IPs e anycast

Por padrão, todo app HTTP recebe:

- 1× **IPv6 dedicado** (gratuito)
- 1× **IPv4 compartilhado** (gratuito, baseado em SNI/Host header)

Para protocolos não-HTTP, UDP, ou TLS termination customizado: precisa **IPv4 dedicado** ($2/mês).

```bash
fly ips list
fly ips allocate-v4                       # IPv4 dedicado ($2/mês)
fly ips allocate-v4 --shared              # IPv4 compartilhado (free)
fly ips allocate-v6
fly ips allocate-v6 --private             # endereço .flycast (interno)
fly ips release <ip>
```

Anycast significa: o **mesmo IP** é anunciado de todas as regiões via BGP. O backbone roteia o request para a Machine mais próxima do usuário.

### Private networking (6PN)

Apps da mesma Org compartilham uma rede WireGuard mesh IPv6 chamada **6PN**. Sem configuração — sempre on.

DNS interno via `.internal`:

- `<app>.internal` — todos os IPs 6PN das Machines started
- `<region>.<app>.internal` — só Machines de uma região (`gru.my-app.internal`)
- `_apps.internal` — TXT com lista de apps da org

```bash
dig +short aaaa my-app.internal @fdaa::3
```

Bind interno: `fly-local-6pn:<port>` (alias para o IPv6 6PN da Machine).

### Flycast (private load balancer)

Por padrão `<app>.internal` é DNS round-robin direto para Machines. **Flycast** roteia via Fly Proxy, habilitando autostart/autostop, geo-routing, TLS termination em apps privadas.

```bash
fly launch --flycast              # nova app privada
fly deploy --flycast              # adicionar a app existente
fly ips allocate-v6 --private     # alocar endereço .flycast
```

DNS: `<app>.flycast` (AAAA record).

**Requisitos**: bind em `0.0.0.0:port` (não `fly-local-6pn`); HTTP only (sem `force_https`).

### WireGuard (acesso ao 6PN do seu laptop)

```bash
fly wireguard create <org>        # gera .conf
# Linux:
sudo cp wg.conf /etc/wireguard/
sudo wg-quick up wg
# macOS/Windows: importar no app WireGuard

# Teste:
dig _apps.internal TXT +short
ping6 my-app.internal
```

### Services (HTTP/TCP/UDP)

Handlers disponíveis:

- **`http`** — normaliza, injeta `Fly-Client-IP`, `X-Forwarded-For`
- **`tls`** — termina TLS, forwarda plaintext
- **`pg_tls`** — TLS específico para Postgres (SNI proxy)
- **`proxy_proto`** — adiciona PROXY protocol header

```toml
[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true
```

UDP requer IPv4 dedicado.

### Custom domains e TLS (ACME)

```bash
fly certs add example.com                 # adiciona + dispara ACME
fly certs add "*.example.com"             # wildcard (DNS-01 challenge)
fly certs list
fly certs check example.com               # diagnóstico DNS
fly certs show example.com
fly certs setup example.com               # exibe DNS records necessários
fly certs remove example.com
fly certs import example.com --fullchain fullchain.pem --private-key key.pem
```

DNS records aceitos (pelo menos um deve verificar):

- `A` + `AAAA` apontando para os IPs do app
- `_acme-challenge.<host>` CNAME (DNS-01, obrigatório para wildcard)
- `_fly-ownership.<host>` TXT (quando atrás de Cloudflare etc.)

**Cloudflare proxy (laranja)**: usar `_fly-ownership` TXT + SSL mode "Full" ou "Full (Strict)". Nunca "Flexible".

Rate limits Let's Encrypt: 50 certs/domínio/semana, 5 duplicates/semana, 5 falhas/host/hora.

URLs: `https://fly.io/docs/networking/`, `https://fly.io/docs/networking/private-networking/`, `https://fly.io/docs/networking/flycast/`, `https://fly.io/docs/networking/services/`, `https://fly.io/docs/networking/custom-domain/`

---

## 7. Persistência

### Fly Volumes

NVMe local na **mesma máquina física** da Machine. Não é network storage.

**Restrições críticas**:

- 1 volume → 1 Machine (não pode ser shared)
- Volume preso a uma região (não migra automaticamente)
- 1 GB default, max 500 GB
- Para HA: provisione **2+ volumes** com replicação no app

```bash
fly volumes create data --region gru --size 10
fly volumes list
fly volumes show <id>
fly volumes destroy <id>
fly volumes extend <id> --size 50
fly volumes snapshots list <id>
fly volumes snapshots create <id>
fly volumes fork <id>                     # cópia independente
```

Snapshots: 5 dias de retenção default (configurável 1-60 dias). $0.08/GB/mês (10GB grátis).

Encryption-at-rest por padrão (use `--no-encryption` se quiser disable, raro).

### Managed Postgres (MPG) — atual em 2026

**[Atenção]** — Existem dois produtos Postgres na história do Fly:

1. **Fly Postgres (legacy)**: `fly postgres create`. Cluster Stolon/repmgr **não-managed** — você operava (backups manuais, failover manual). **Descontinuação progressiva** desde 2024.
2. **Managed Postgres (MPG)** — produto atual: HA com failover automático, backups encrypted, monitoring, connection pooling, pgvector + PostGIS.

```bash
fly mpg create                            # interativo
fly mpg list
fly mpg connect <cluster>
fly mpg status <cluster>
```

- 12 regiões disponíveis (inclui `gru` São Paulo)
- Storage até 1 TB, $0.28/GB/mês
- Plano Basic ($38/mês, 1GB RAM) → Performance ($1.922/mês, 64GB RAM)
- Em desenvolvimento: patches automáticos, version upgrades, alerting, migration tools

### Upstash Redis

Integração nativa com Upstash, gerenciado externamente:

```bash
fly redis create
fly redis status <id>
fly redis connect <id>
```

> **Nota CIE**: o projeto já usa Upstash Redis (instância `cie-prod` em `sa-east-1`, ver `CLAUDE.md` → "Cache — Upstash Redis"). Ao migrar para Fly, basta apontar o mesmo `REDIS_URL` — não precisa criar instância nova via `fly redis`.

### Tigris (object storage S3-compatible)

```bash
fly storage create                        # cria bucket Tigris
```

API S3 padrão — use qualquer SDK (boto3, AWS SDK).

### LiteFS / SQLite

Distribuição replicada de SQLite via FUSE. Read replicas em múltiplas regiões, writes vão para o primary. Bom para apps read-heavy. Config via sidecar container ou processo dedicado.

URLs: `https://fly.io/docs/volumes/`, `https://fly.io/docs/mpg/`, `https://fly.io/docs/database-storage-guides/`

---

## 8. Secrets e config

```bash
fly secrets set DATABASE_URL=postgres://...      # 1 secret
fly secrets set KEY1=val1 KEY2=val2              # múltiplos
fly secrets set DATABASE_URL=... --stage         # não dispara restart (aplica no próximo deploy)
fly secrets list                                  # nomes + digests (não valores)
fly secrets unset KEY1 KEY2
fly secrets deploy                                # força restart aplicando staged secrets
```

- Encrypted no vault. API só pode encrypt; decrypt acontece no boot da Machine (token efêmero).
- Default: setar secret reinicia todas as Machines.
- Injetados como **env vars** no runtime.
- **Build secrets** são separados: usar `--build-secret` no `fly deploy` ou `[build.args]` para non-sensitive.

### Mount como arquivo (`[[files]]`)

```bash
fly secrets set TLS_CERT=$(cat cert.pem | base64)
```

```toml
[[files]]
  guest_path = "/etc/cert.pem"
  secret_name = "TLS_CERT"
```

### Rotação

- Setar nova versão sobrescreve.
- Histórico não é mantido (ao contrário de Secret Manager do GCP).
- Rotação manual: `fly secrets set NEW_VAL=...` → o restart aplica.

URLs: `https://fly.io/docs/apps/secrets/`

---

## 9. Observabilidade

### Logs

```bash
fly logs                                  # tail live
fly logs --app my-app
fly logs --region gru                     # filtra por região
fly logs --instance <machine-id>          # 1 Machine
fly logs -n                               # no follow (snapshot)
```

- Live tail no dashboard
- Search via Grafana (beta)
- API de logs programática
- Export: NATS streaming oficial, ou shipper para Datadog/Logtail/etc.

### Métricas

- **Built-in**: Prometheus managed (CPU, RAM, network, disk). Disponível no dashboard + endpoint Prometheus.
- **Grafana managed**: dashboards prontos por org. Grátis na Hobby tier.
- **Custom metrics**: expor `/metrics` no app (formato Prometheus), config em `fly.toml`:

  ```toml
  [metrics]
    port = 9091
    path = "/metrics"
  ```

### Healthchecks

Dois tipos:

**HTTP service checks** (afetam roteamento):

```toml
[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "10s"
  method = "GET"
  path = "/health"
  protocol = "http"
```

**Independent checks** (não afetam roteamento, só observability):

```toml
[checks.deep]
  type = "http"             # ou "tcp"
  port = 8080
  path = "/health/deep"
  interval = "60s"
  timeout = "10s"
```

### Tracing

OpenTelemetry suportado via export para Honeycomb, Tempo, etc. Integração Sentry oficial (com créditos pra orgs Fly).

URLs: `https://fly.io/docs/monitoring/`

---

## 10. Scaling

### Horizontal (count)

```bash
fly scale count 3                                 # 3 Machines no primary region
fly scale count 5 --region gru                    # 5 em gru
fly scale count app=3 worker=2                    # por process group
fly scale show
```

### Vertical (size)

```bash
fly scale vm shared-cpu-2x                        # muda preset
fly scale vm performance-2x --memory 4096
fly scale memory 2048                             # só RAM
fly scale show
```

### Por região

```bash
fly regions list
fly regions add gru gig
fly regions remove gig
fly regions backup gru gig                        # ordem de fallback
```

### Autoscaling

Não há autoscaling clássico baseado em CPU/RAM. Em vez disso: **autostart/autostop** baseado em load do Fly Proxy + concurrency limits.

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

  [http_service.concurrency]
    type = "requests"
    soft_limit = 200       # acima disso, Proxy começa a startar mais Machines
    hard_limit = 250       # acima disso, request enfileira/falha
```

Para escalar, você precisa **pré-criar Machines stopped** com `fly scale count`, e o Proxy as startará sob demanda.

URLs: `https://fly.io/docs/launch/scale-count/`, `https://fly.io/docs/launch/scale-machines/`

---

## 11. Regions

18 regiões em produção:

| Código | Cidade | Continente |
|---|---|---|
| `iad` | Ashburn, VA | NA |
| `ord` | Chicago | NA |
| `dfw` | Dallas | NA |
| `lax` | Los Angeles | NA |
| `sjc` | San Jose | NA |
| `ewr` | Secaucus, NJ | NA |
| `yyz` | Toronto | NA |
| `mia` | Miami **[Atenção]** — pode estar listado como secundário, validar com `fly platform regions` |
| `gru` | **São Paulo** | SA |
| `gig` | **Rio de Janeiro** — validar disponibilidade atual (pode ter sido descontinuada) |
| `ams` | Amsterdam | EU |
| `arn` | Stockholm | EU |
| `cdg` | Paris | EU |
| `fra` | Frankfurt | EU |
| `lhr` | London | EU |
| `bom` | Mumbai | APAC |
| `nrt` | Tokyo | APAC |
| `sin` | Singapore | APAC |
| `syd` | Sydney | APAC |
| `jnb` | Johannesburg | AFR |

```bash
fly platform regions                              # lista oficial atualizada
fly status                                         # mostra regions atuais do app
```

**Primary region**: setada em `fly.toml` (`primary_region = "gru"`). Importante para:

- `min_machines_running` aplica só ao primary
- Database writes em apps multi-region (LiteFS, Postgres replica reads)
- Default para novas Machines

Cada Machine expõe `FLY_REGION` env var (ex: `gru`).

**Volumes e Machines são tied à região onde foram criados** — não migram.

URLs: `https://fly.io/docs/reference/regions/`

---

## 12. Multi-region

Padrões oficiais:

- **Stateless apps**: simplesmente `fly regions add`. Anycast roteia user → Machine mais próxima.
- **Read-heavy DB**: LiteFS (SQLite) replica para todas as regiões; writes vão para primary.
- **Postgres**: MPG suporta read replicas em outras regiões.
- **fly-replay header**: app pode responder com header `fly-replay: region=iad` e o Proxy retransmite o request para outra região (útil para "escrever sempre no primary").

```http
HTTP/1.1 409 Conflict
fly-replay: region=iad
```

Outros headers úteis:

- `fly-prefer-region: gru` (cliente sugere região)
- `fly-force-instance-id: <machine-id>` (sticky a 1 Machine)

URLs: `https://fly.io/docs/blueprints/multi-region-fly-replay/`

---

## 13. CI/CD

### Deploy tokens

```bash
fly tokens create deploy -x 999999h               # token de deploy (longo prazo)
fly tokens create deploy --app my-app             # scoped a 1 app
fly tokens list
fly tokens revoke <id>
```

### GitHub Actions

`.github/workflows/fly.yml`:

```yaml
name: Fly Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    concurrency: deploy-group
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Salvar `FLY_API_TOKEN` em GitHub Secrets.

`--remote-only` faz o build no **Fly Builder** (Machine remota) — não precisa Docker no runner.

### Preview apps (PR environments)

Padrão oficial: action que cria 1 app por PR (ex: `my-app-pr-123`), deploy nele, e `fly apps destroy` ao fechar PR. Ver blueprint `git-branch-preview-environments`.

URLs: `https://fly.io/docs/launch/continuous-deployment-with-github-actions/`

---

## 14. Pricing (atual em 2026)

**[Atenção]** — preços coletados da página oficial em maio 2026. Sempre validar em `https://fly.io/docs/about/pricing/` antes de orçar.

### Compute

- **Shared CPUs** (econômicas, com burst de 500s):
  - `shared-cpu-1x` 256MB: ~$0.0028/h ≈ **$2.02/mês** (region Amsterdam)
  - Mais barato em `iad`, mais caro em `gru` / `syd`
- **Performance CPUs** (dedicadas):
  - `performance-1x` 2GB: ~$0.0447/h ≈ **$32.19/mês**

Cobrança **per-second** apenas em Machines `started`. Stopped: só rootfs ($0.15/GB/mês).

### Reserved compute

40% desconto em blocos reservados:

- Shared: $36/ano = $5/mês de crédito
- Performance: $144/ano = $20/mês de crédito

### Volumes

- **Provisioned**: $0.15/GB/mês
- **Snapshots**: $0.08/GB/mês (10GB grátis/mês)

### Network

- **Shared IPv4**: grátis (1 por app HTTP)
- **Dedicated IPv4**: $2/mês
- **IPv6**: grátis
- **Static egress IP** (per-Machine): $0.005/h ≈ $3.60/mês
- **Egress de dados**: $0.02–$0.12/GB (varia por grupo de região; Norte Global mais barato, APAC/SA/AFR mais caro)

### Certificates

- Let's Encrypt: $0.10/mês por hostname (10 grátis)
- Wildcard: $1/mês

### Managed Postgres

- Basic: $38/mês (1GB RAM)
- Performance: $1.922/mês (64GB RAM)
- Storage: $0.28/GB/mês

### Free tier

**Não existe mais** (descontinuado em 2024). Cartão obrigatório no signup. Pequenos workloads ainda podem custar < $5/mês.

### Plans de suporte

- Community: free
- Standard: $29/mês
- Fly Kubernetes (FKS): $75/mês por cluster + compute

URLs: `https://fly.io/docs/about/pricing/`

---

## 15. Casos de uso típicos

### Next.js standalone

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
CMD ["node", "server.js"]
```

```toml
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

### Python Flask/FastAPI

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8080", "app:app"]
```

### Background workers

Process group separado:

```toml
[processes]
  web = "gunicorn -w 2 -b 0.0.0.0:8080 app:app"
  worker = "celery -A app worker -l info"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
  processes = ["web"]

[[vm]]
  size = "shared-cpu-2x"
  memory = "1024mb"
  processes = ["worker"]
```

Workers normalmente com `auto_stop_machines = "off"` (não têm tráfego HTTP que dispara autostart).

### Cron jobs / scheduled tasks

**[Atenção]** — Fly **não tem cron primitivo nativo no flyctl**. Padrões oficiais (blueprints):

1. **Cron Manager**: app Fly que dispara Machines via API em horários definidos
2. **Supercronic**: roda `crontab` dentro de uma Machine sempre-on
3. **Machines API + GitHub Actions**: cron do GitHub Actions chama `fly machine run` para job one-shot

Não há `fly machine run --schedule` no CLI atual.

> **Implicação CIE**: o stack atual depende de Cloud Scheduler para vários jobs (`cie-etl-ads-daily`, `cie-campaign-monitoring`, `cie-broadcast-dispatch`, `cie-adsense-poll`). Migrar para Fly exigiria uma das 3 estratégias acima — opção mais limpa é manter Cloud Scheduler do GCP chamando endpoints HTTP públicos do Fly (não há lock-in de Scheduler).

### Docker arbitrário

```bash
fly machine run nginx:latest --port 80/tcp:http
fly machine run postgres:16 --env POSTGRES_PASSWORD=x --volume pg_data:/var/lib/postgresql/data
```

URLs: `https://fly.io/docs/blueprints/`

---

## 16. Segurança

### SSH em Machines

```bash
fly ssh console                                   # SSH em uma Machine random
fly ssh console -s                                # selecionar Machine
fly ssh console --machine <id>                    # Machine específica
fly ssh console -C "ls /app"                      # comando one-shot
fly ssh issue                                     # gera cert SSH local
fly ssh sftp shell                                # SFTP
```

SSH usa cert efêmero assinado pela org (não chaves fixas). `fly proxy` cria túnel local:

```bash
fly proxy 5432:5432 -a my-postgres                # acessar Postgres interno via localhost
```

### Tokens

```bash
fly tokens create deploy -x 999999h               # deploy token (CI)
fly tokens create org <org>                       # org-wide token
fly tokens create deploy --app my-app             # scoped a app
fly tokens list
fly tokens revoke <id>
```

Tipos:

- **Deploy tokens**: deploy + read básico em 1 app ou org
- **Org tokens**: full access à org
- **OIDC tokens**: para integrações third-party (sem long-lived secret)

### RBAC

- **Member**: pode deploy, ver logs, manage Machines
- **Admin**: tudo do Member + billing + invites + remoção
- SSO via Google ou GitHub para auth org-wide

### Compliance

- SOC 2 Type II
- Hardware isolation via Firecracker (não shared kernel)
- TLS 1.2+ default
- Encryption-at-rest em volumes

### Boas práticas

- Rotacionar deploy tokens periodicamente
- Não dar admin pra CI (use deploy tokens scoped por app)
- Secret rotation via `fly secrets set` + force restart
- Para casos sensíveis: `fly machine cordon` antes de SSH para investigação

URLs: `https://fly.io/docs/security/`

---

## 17. CLI cheat sheet

```bash
# Auth
fly auth signup | login | logout | whoami | token

# Apps
fly apps list
fly apps create <name>
fly apps destroy <name>
fly apps move <name> --org <org>
fly apps open                                     # abre URL no browser
fly status                                        # estado do app atual
fly info                                          # detalhes

# Deploy
fly launch [--no-deploy] [--copy-config] [--flycast]
fly deploy [--remote-only] [--strategy bluegreen] [--image <ref>]
fly releases [--image]
fly releases rollback <version>

# Machines
fly machine list | status <id> | run <img> | start | stop | suspend | restart | destroy | clone | update <id> | cordon | uncordon

# Scale
fly scale show
fly scale count <N>
fly scale vm <preset> [--memory <mb>]
fly scale memory <mb>

# Regions
fly regions list | add <code> | remove <code> | backup <codes>
fly platform regions

# Volumes
fly volumes create <name> --region <r> --size <gb>
fly volumes list | show <id> | destroy <id> | extend <id> --size <gb> | fork <id>
fly volumes snapshots list <vol> | create <vol>

# Secrets
fly secrets set KEY=val [--stage]
fly secrets list | unset <KEY>
fly secrets deploy

# Networking
fly ips list | allocate-v4 [--shared] | allocate-v6 [--private] | release <ip>
fly certs add <host> | list | check <host> | show <host> | remove <host>
fly wireguard create | list | remove

# Observability
fly logs [--region <r>] [--instance <id>] [-n]
fly dashboard metrics

# Access
fly ssh console [-s] [--machine <id>] [-C "cmd"]
fly ssh issue
fly proxy <local>:<remote> -a <app>
fly tokens create deploy [-x <duration>] [--app <name>]

# Postgres (managed)
fly mpg create | list | connect <id> | status <id>
fly mpg attach <id> --app <my-app>                # injeta DATABASE_URL secret

# Redis
fly redis create | list | status <id> | connect <id>

# Org
fly orgs list | create <name> | invite <email>
```

---

## 18. Limitações conhecidas e armadilhas

### Volumes

- **Não migram entre regiões.** Precisa snapshot + create na nova região + restore.
- **1 volume = 1 Machine.** Sem shared filesystem nativo.
- **Single-machine + single-volume = SPOF.** Sempre rode 2+ instâncias com volumes separados.
- Snapshots têm 5 dias default — não confie só neles para backup de longo prazo.

### Networking

- **Shared IPv4 + non-HTTP não funciona.** Apps TCP/UDP custom precisam IPv4 dedicado.
- **UDP requer config explícita** + IPv4 dedicado.
- **Cloudflare proxy "orange"** quebra ACME HTTP-01 — usar `_fly-ownership` TXT.
- **6PN é IPv6 only** — apps que só falam IPv4 precisam dual-stack ou `fly-local-6pn` alias.

### Deploy

- **Blue-green requer 2+ Machines.** Em apps single-machine, vira rolling automaticamente.
- **`release_command`** roda em VM temporária **sem mounts de volume** — não use para tarefas que precisam de dados persistentes.
- **`fly deploy` ignora Machines criadas via `fly machine run`** por default.

### Scaling

- **Scale-to-zero tem cold start**: ~300ms-1s com `suspend`, 1-3s com `stop`. Fora SLA de 100ms se latência crítica.
- **Não há autoscaling por CPU/RAM.** Só autostart/autostop por load do Proxy + concurrency limits.
- **`min_machines_running`** aplica só na primary region (não multi-region).

### Billing

- **Per-machine, não per-request.** App ocioso com 3 Machines started cobra 3x (compare com Cloud Run que cobra zero).
- **Stopped Machines ainda cobram rootfs** — destrua se não for reutilizar.
- **Cross-region traffic** (egress entre regiões da Fly) não é grátis em todos os casos — validar.
- **Volumes provisionados são pagos integralmente**, não pelo usado.

### Machines

- **Imagem precisa ter init que aceita SIGTERM** — graceful shutdown em 30s antes de SIGKILL.
- **Shared CPU tem burst budget finito** (500s). Workloads sustained CPU-heavy precisam `performance-*`.
- **ARM (a1000)** disponível mas nem todas as imagens estão buildadas multi-arch — verificar `docker manifest inspect`.

### Operacionais

- **Free tier não existe mais (post-2024).** Mínimo prático ~$2-5/mês.
- **Status page tem histórico de incidents** — operacionalmente menos maduro que GCP/AWS, mas tem melhorado.
- **Suporte Community é via fórum** — resposta ad-hoc. Standard plan ($29/mês) destrava SLA real.

---

## URLs consultadas

- `https://fly.io/docs/`
- `https://fly.io/docs/getting-started/`
- `https://fly.io/docs/flyctl/`
- `https://fly.io/docs/flyctl/install/`
- `https://fly.io/docs/launch/deploy/`
- `https://fly.io/docs/launch/autostop-autostart/`
- `https://fly.io/docs/launch/continuous-deployment-with-github-actions/`
- `https://fly.io/docs/reference/configuration/`
- `https://fly.io/docs/reference/regions/`
- `https://fly.io/docs/machines/`
- `https://fly.io/docs/machines/cpu-performance/`
- `https://fly.io/docs/machines/flyctl/fly-machine-run/`
- `https://fly.io/docs/networking/`
- `https://fly.io/docs/networking/private-networking/`
- `https://fly.io/docs/networking/services/`
- `https://fly.io/docs/networking/flycast/`
- `https://fly.io/docs/networking/custom-domain/`
- `https://fly.io/docs/volumes/`
- `https://fly.io/docs/volumes/overview/`
- `https://fly.io/docs/mpg/`
- `https://fly.io/docs/database-storage-guides/`
- `https://fly.io/docs/apps/secrets/`
- `https://fly.io/docs/monitoring/`
- `https://fly.io/docs/about/pricing/`
- `https://fly.io/docs/security/`
- `https://fly.io/docs/blueprints/`

### Páginas que retornaram 404 (URLs candidatas — validar antes de citar)

- `/docs/apps/scale-machines/`
- `/docs/blueprints/scheduled-machines/`
- `/docs/networking/ips/`
- `/docs/networking/dns-and-load-balancing/`
- `/docs/blueprints/github-actions-continuous-deployment/`
- `/docs/machines/sizing/`
- `/docs/machines/autostart-stop/`

> Vale validar essas seções (especialmente IPs detalhados, machine sizing presets completos, e cron/scheduled jobs) consultando as URLs equivalentes vigentes via dashboard ou search interno do Fly antes de tomar decisão de plataforma com base nelas.
