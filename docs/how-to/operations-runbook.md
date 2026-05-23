# How-to — Runbook de operação do Fly Cron Runner

> **Audiência**: operador que já fez o setup inicial e precisa fazer uma tarefa pontual ou diagnosticar um problema.
> **Para setup do zero**: ver [Tutorial](../tutorials/deploying-fly-runner-from-scratch.md).
> **Para referência de arquivos/env/comandos**: ver [Reference](../reference/runner-reference.md).
>
> Cada receita é autossuficiente. Cola, executa, segue.

---

## Sumário

### Operação rotineira

- [1. Rodar uma skill manualmente em produção](#1-rodar-uma-skill-manualmente-em-produção)
- [2. Adicionar nova skill ao cron](#2-adicionar-nova-skill-ao-cron)
- [3. Mudar o horário do cron](#3-mudar-o-horário-do-cron)
- [4. Inspecionar logs de uma run específica](#4-inspecionar-logs-de-uma-run-específica)
- [5. Inspecionar manifest gerado pela skill](#5-inspecionar-manifest-gerado-pela-skill)
- [6. Listar runs do dia](#6-listar-runs-do-dia)

### Atualização

- [7. Atualizar Claude Code CLI no container](#7-atualizar-claude-code-cli-no-container)
- [8. Atualizar 1 secret específico](#8-atualizar-1-secret-específico)
- [9. Atualizar todos os secrets de uma vez](#9-atualizar-todos-os-secrets-de-uma-vez)
- [10. Re-deploy forçando rebuild sem cache](#10-re-deploy-forçando-rebuild-sem-cache)

### Recuperação

- [11. Rotacionar / reseedar OAuth do Claude.ai](#11-rotacionar--reseedar-oauth-do-claudeai)
- [12. Reseed completo do volume (catástrofe)](#12-reseed-completo-do-volume-catástrofe)
- [13. Rollback para deploy anterior](#13-rollback-para-deploy-anterior)

### Diagnóstico

- [14. Deploy falha com `503`](#14-deploy-falha-com-503)
- [15. Deploy falha com `UID is not unique`](#15-deploy-falha-com-uid-is-not-unique)
- [16. Skill retorna `exit=3`](#16-skill-retorna-exit3)
- [17. Skill retorna `exit=124`](#17-skill-retorna-exit124)
- [18. Erro Meta `100/3858634 verified advertiser missing`](#18-erro-meta-1003858634-verified-advertiser-missing)
- [19. Erro OpenAI `billing_hard_limit_reached`](#19-erro-openai-billing_hard_limit_reached)
- [20. Cron não disparou no horário esperado](#20-cron-não-disparou-no-horário-esperado)
- [21. Skill exit=0 mas Ads Manager vazio](#21-skill-exit0-mas-ads-manager-vazio)

---

## 1. Rodar uma skill manualmente em produção

**Quando usar**: smoke test após deploy, validar que tudo funciona, ou disparar um run extra fora do cron.

```bash
fly ssh console -a meta-agents-v3 -C "runuser -u runner -- /app/scripts/run-skill.sh create-traffic-<nome-cliente>-campaign"
```

> ⚠️ Sempre `runuser -u runner --`, **nunca** `su - runner -c`. O `su -` apaga env vars do PID 1 e a skill roda em modo degradado (sem OpenAI, sem Supabase). Detalhes no [Tutorial §A.7](../tutorials/deploying-fly-runner-from-scratch.md#a7-su---runner--c-apaga-env-vars-do-pid-1).

**Tempo**: 5–15 min. **Output**: a saída completa da skill + linha final `RUN_RESULT skill=... exit=<N> log=...`.

---

## 2. Adicionar nova skill ao cron

**Quando usar**: você criou uma nova skill em `.claude/skills/<slug>/SKILL.md` e quer que rode em cadência regular.

1. Edita `crontab` no repo local:

```bash
cd /mnt/c/agents_team_meta_ads_v3
nano crontab
```

Adiciona uma linha (separa horários pra evitar overlap da execução anterior — skills levam ~10min):

```
0 10 * * * /app/scripts/run-skill.sh create-traffic-<nome-cliente>-campaign
30 10 * * * /app/scripts/run-skill.sh <novo-slug>
```

2. Commit + deploy:

```bash
git add crontab
git commit -m "feat(cron): adicionar entrada diária para <novo-slug>"
fly deploy --remote-only
```

3. Valida sintaxe dentro do container:

```bash
fly ssh console -a meta-agents-v3 -C "supercronic -test /app/crontab"
```

Tem que retornar sem erro.

---

## 3. Mudar o horário do cron

Edita `crontab`, ajusta o `m h dom mon dow` da linha desejada, `fly deploy --remote-only`. TZ do container é `America/Sao_Paulo` (configurado no `Dockerfile`), então a expressão é interpretada em BRT.

Lembrete dos campos cron:
```
m  h  dom mon dow
0  10 *   *   *     → todo dia às 10:00 BRT
0  10 *   *   1-5   → seg-sex 10:00 BRT
0  */6 *  *   *     → a cada 6 horas
```

---

## 4. Inspecionar logs de uma run específica

Logs ficam em `/var/log/runs/` no volume (sobrevivem a reboot).

```bash
fly ssh console -a meta-agents-v3 -C "ls -la /var/log/runs/"
```

Pra ver um log específico (substitua o nome do arquivo):

```bash
fly ssh console -a meta-agents-v3 -C "cat /var/log/runs/20260522T213757Z-create-traffic-<nome-cliente>-campaign.log"
```

Logs em **tempo real** (todos os jobs + supercronic):

```bash
fly logs -a meta-agents-v3
```

(Ctrl+C pra fechar.)

---

## 5. Inspecionar manifest gerado pela skill

Skills gravam manifest JSON com IDs do Meta, lista de imagens, bloqueios encontrados etc. Local: `/app/tentativas-geracao-de-campanhas/<ts>-trafego.json`.

```bash
fly ssh console -a meta-agents-v3 -C "ls /app/tentativas-geracao-de-campanhas/"
fly ssh console -a meta-agents-v3 -C "cat /app/tentativas-geracao-de-campanhas/20260522-1846-trafego.json | jq ."
```

Estrutura típica (ver [spec §2.3](../specs/flyio-cron-campaign-runner.md#23-contrato-de-saída)):

```json
{
  "client": "<nome-cliente>",
  "campaign_id": "...",
  "adset_id": "...",
  "ad_ids": ["...", "...", "..."],
  "daily_budget_cents": 5000,
  "verified": true,
  "blockers": []
}
```

---

## 6. Listar runs do dia

```bash
fly ssh console -a meta-agents-v3 -C "ls /var/log/runs/$(date -u +%Y%m%d)*"
```

Se vazio: ainda não rodou hoje (ou cron não disparou — ver [§20](#20-cron-não-disparou-no-horário-esperado)).

---

## 7. Atualizar Claude Code CLI no container

A imagem instala `@anthropic-ai/claude-code@latest` no build. Pra forçar atualização:

```bash
cd /mnt/c/agents_team_meta_ads_v3
fly deploy --remote-only --no-cache
```

`--no-cache` força rebuild completo, incluindo o `npm install -g @anthropic-ai/claude-code`.

**Recomendado**: pinar versão exata. Edita o `Dockerfile`:

```diff
- ARG CLAUDE_CODE_VERSION=latest
+ ARG CLAUDE_CODE_VERSION=2.1.148
```

Commit + deploy normal.

---

## 8. Atualizar 1 secret específico

```bash
fly secrets set CHAVE=novo_valor -a meta-agents-v3
```

Isso **dispara um deploy automático** (~30s) — a Machine reinicia com o novo secret.

---

## 9. Atualizar todos os secrets de uma vez

Usa o mesmo loop do tutorial (§Passo 1), evita N deploys em sequência:

```bash
cd /mnt/c/agents_team_meta_ads_v3
SECRETS_ARGS=()
while IFS='=' read -r k v; do
  k="${k%$'\r'}"
  v="${v%$'\r'}"
  [[ -z "$k" || "$k" =~ ^# ]] && continue
  SECRETS_ARGS+=("$k=$v")
done < .env.local
fly secrets set "${SECRETS_ARGS[@]}" -a meta-agents-v3
```

Strip do `\r` é obrigatório se `.env.local` foi editado no Windows.

---

## 10. Re-deploy forçando rebuild sem cache

```bash
fly deploy --remote-only --no-cache
```

Útil quando:
- Suspeita-se de cache corrompido nos builders.
- Quer atualizar versão `latest` de uma dep que não mudou `package.json`.
- Mudou o conteúdo de algum arquivo `COPY`ado mas o build não detectou.

---

## 11. Rotacionar / reseedar OAuth do Claude.ai

**Quando usar**: token expirou (raro, geralmente 6+ meses), suspeita de comprometimento, ou mudança da conta Claude.ai que opera o runner.

```bash
fly ssh console -a meta-agents-v3
# dentro do container:
rm /home/runner/.claude/.credentials.json /home/runner/.claude.json
exit

# fora, segue passo 4 do tutorial novamente:
fly ssh console -a meta-agents-v3
claude          # OAuth interativo
# após sucesso:
cp -a /root/.claude/. /home/runner/.claude/
cp /root/.claude.json /home/runner/.claude.json 2>/dev/null
chown -R runner:runner /home/runner/.claude /home/runner/.claude.json
exit
```

Próxima run do cron usa novos tokens. Testa com [§1](#1-rodar-uma-skill-manualmente-em-produção).

---

## 12. Reseed completo do volume (catástrofe)

**Quando usar**: volume corrompido, dados perdidos, ou rebuild forçado por upgrade Fly.

⚠️ **Destrutivo** — você perde TODOS os logs históricos + estado dos connectors.

```bash
# 1. Para a Machine
fly machine stop $(fly machine list -a meta-agents-v3 --json | jq -r '.[0].id') -a meta-agents-v3

# 2. Destrói o volume antigo
fly volumes destroy $(fly volumes list -a meta-agents-v3 --json | jq -r '.[0].id') --yes -a meta-agents-v3

# 3. Cria volume novo (mesmo nome)
fly volumes create claude_state --size 1 --region gru -a meta-agents-v3

# 4. Re-deploy (anexa novo volume à Machine)
fly deploy --remote-only

# 5. Refaz seed OAuth (passo 4 do tutorial)
fly ssh console -a meta-agents-v3
claude
# ... segue o fluxo
```

---

## 13. Rollback para deploy anterior

**Quando usar**: deploy novo quebrou alguma coisa e você quer voltar pra versão anterior funcional.

1. Lista releases:

```bash
fly releases -a meta-agents-v3
```

Identifica a versão funcional (ex: `v23`).

2. Pega o image tag dessa versão:

```bash
fly releases -a meta-agents-v3 --image v23
```

Output inclui algo tipo `Image: registry.fly.io/meta-agents-v3:deployment-01KS...`.

3. Atualiza a Machine pro tag antigo:

```bash
fly machine update $(fly machine list -a meta-agents-v3 --json | jq -r '.[0].id') \
  --image registry.fly.io/meta-agents-v3:deployment-01KS... \
  -a meta-agents-v3
```

Machine reinicia em segundos com imagem antiga. Secrets + volume permanecem.

---

## 14. Deploy falha com `503`

Sintoma:

```
Error: failed to fetch an image or build from source: failed to get organization <org> (status 503)
```

**Causa**: incidente público no Fly.io.

**Diagnóstico**:

```bash
curl -s https://status.flyio.net/api/v2/status.json | jq .status
```

Ou no browser: https://status.flyio.net/

**Fix**: espera 15–90 min, retry `fly deploy --remote-only`. Nada do nosso lado resolve.

---

## 15. Deploy falha com `UID is not unique`

Sintoma:

```
useradd: UID 1001 is not unique
```

**Causa**: alguém mudou a base do Dockerfile pra uma imagem que já usa UID 1001 (ou seu UID atual).

**Fix**: edita o `Dockerfile`, troca pra UID livre (ex: 1002 ou 2000):

```diff
- RUN useradd -m -u 1001 -s /bin/bash runner ...
+ RUN useradd -m -u 1002 -s /bin/bash runner ...
```

Re-deploy. Lembrar: o volume foi criado com chown pro UID antigo — pode precisar de `chown -R 1002:1002 /home/runner/.claude` na primeira boot.

---

## 16. Skill retorna `exit=3`

Sintoma no log:

```
ERROR: /home/runner/.claude/.credentials.json missing — Claude OAuth not seeded.
RUN_RESULT skill=... exit=3
```

**Causa**: OAuth nunca foi seedado, ou foi deletado, ou o volume é novo.

**Fix**: faça o [Passo 4 do Tutorial](../tutorials/deploying-fly-runner-from-scratch.md#passo-4--seed-do-oauth-do-claudeai) novamente.

---

## 17. Skill retorna `exit=124`

Sintoma:

```
RUN_RESULT skill=... exit=124
```

**Causa**: `timeout 1500` (25 min) atingido. A skill travou em alguma etapa.

**Diagnóstico**:

```bash
fly ssh console -a meta-agents-v3 -C "cat /var/log/runs/<ts>-*.log | tail -100"
```

Identifica qual etapa travou (provavelmente uma chamada API longa).

**Fix**:

- Se foi `gpt-image-2` lento: a OpenAI tá lenta hoje, espera próximo run.
- Se foi Meta MCP timeout: idem.
- Se travou sempre no mesmo lugar: investiga a skill, considera dividir em sub-skills menores.
- Se quiser aumentar o timeout: edita `scripts/run-skill.sh`, troca `RUN_TIMEOUT_SEC=${RUN_TIMEOUT_SEC:-1500}` pra valor maior. Deploy.

---

## 18. Erro Meta `100/3858634 verified advertiser missing`

> **⚠️ WORKAROUND ATIVO** (desde 2026-05-22): a skill `/create-traffic-<nome-cliente>-campaign` cria o AdSet com `targeting={"countries":["US"]}` como placeholder em vez de BR, contornando a validação Meta. O operador precisa **editar targeting US→BR via Ads Manager UI antes de ativar**; nesse momento a UI força selecionar advertiser/payer (escolher Nome empresa). Quando o form de review for aprovado, reverter o workaround editando `SKILL.md` Step 5.2 (mudar `"US"` → `"BR"` e tirar `[NEEDS-RETARGET-BR]` do nome do AdSet).


**Causa real (validada após 4 tentativas + investigação via help articles oficiais)**: a Meta exige **DOIS** requisitos cumulativos pra criar AdSet via Marketing API targeting país regulamentado (BR/UE/IN/TH/TW/AU/SG):

1. **Payload**: passar `dsa_beneficiary` e `dsa_payor` no `ads_create_ad_set`. **Necessário, mas não suficiente.**
2. **UI-only setup**: a ad account precisa ter um **par advertiser/payer "verified" pré-registrado** via Ads Manager → Advertising Settings. **Não dá pra fazer via Marketing API.**

Sem o item 2, qualquer string passada no item 1 é rejeitada — mesmo a razão social oficial da BM verificada. A mensagem "Advertiser is missing" se refere ao **par verificado faltando na ad account**, não ao status da BM.

**Não confunda**:
- Business Verification ≠ Advertiser/Payer registration. Você pode ter BM verificada (Nome empresa está desde set/2023, inclusive como Tech Provider) e ainda assim ver esse erro.
- A Meta renomeou "beneficiary" → "advertiser" em mar/2026 ([fonte](https://www.facebook.com/business/help/983527276402621)). Daí o termo "Advertiser is missing" mesmo que o campo na API se chame `dsa_beneficiary`.

**Fix de payload (já aplicada para nome do cliente)**: a skill `/create-traffic-<nome-cliente>-campaign` passa os 2 campos no Step 5.2 com a razão social `NOME-DO-PAGADOR`. Esse passo está correto e é prerequisite — mas só funciona depois do setup UI abaixo.

**Fix em ordem de tentativa (validada empiricamente em 2026-05-22)**:

A tela de Advertising Settings (`https://adsmanager.facebook.com/adsmanager/manage/advertising_settings/beneficiary_payer?act=<AD_ACCOUNT_ID>`) tem 6 seções: "Anunciante e pagador padrão" (topo) + 5 overrides (UE, Índia, Austrália, Singapura, Taiwan). **Brasil NÃO tem seção própria** nessa tela e, na prática, **configurar o default geral via UI não habilita ads BR** — a config salva no UI mas é silenciosamente revertida no backend.

**Caminho real (1 caso confirmado em 2026-05-22)** — submeter form de review oficial Meta:

URL: **https://www.facebook.com/business/help/1024444835591336**

Você precisa de "full control" da ad account. Submeter:

| Campo | Exemplo (nome do cliente) |
|---|---|
| Ad account ID | `225179730538661` |
| Ad set IDs (opcional) | qualquer adset PAUSED de tentativa anterior |
| Payer name (como digitado na tentativa) | `NOME-DO-PAGADOR` |
| Advertiser name (se diferente do payer) | mesmo, em geral |
| Business address | endereço da razão social no CNPJ |
| Website | URL da landing |
| Tax ID | CNPJ ativo |
| Facebook Page URL | URL pública da page promovida |

Decisão da Meta chega no support inbox e por email em **até 2 dias úteis**.

**Caminhos alternativos enquanto espera o review**:

- **Tentar criar 1 ad set manualmente via UI** com targeting BR. No ad set form, role até "Transparência do anúncio" no final — às vezes a UI mostra prompt útil específico (botão "Verificar pra Brasil" ou similar) que o erro API esconde. Se aparecer opção, segue o fluxo.
- **Meta Business Support chat ao vivo**: https://business.facebook.com/business/help/support — explica que está com erro `3858634` em ad set targeting BR, ad account verified, e que o default UI não persiste.

**O que NÃO funciona (testado e descartado)**:

- ❌ Configurar a seção UE — só cobre países UE, não BR.
- ❌ Configurar o "Anunciante e pagador padrão" (default geral) — UI confirma "Definido com sucesso" mas backend silenciosamente reverte; testes via Marketing API continuam falhando idênticos com e sem campos no payload.
- ❌ Passar `dsa_beneficiary`/`dsa_payor` no payload com a razão social verificada — necessário, mas só funciona depois do review aprovado.

**Como confirmar que o default foi setado**: criar um ad set de teste via Marketing API targeting BR — se passar sem `100/3858634`, está OK.

**Detalhe técnico**: o endpoint Graph API `/act_<id>/beneficiary_payer` é **read-only** ([doc](https://developers.facebook.com/docs/graph-api/reference/beneficiary-payer/)). Não há como registrar via API. Foi por isso que as 4 tentativas iniciais falharam mesmo passando os campos no payload.

**Fontes**:
- [Meta Help — Advertiser and payer requirements (EU/BR)](https://www.facebook.com/business/help/605021638170961)
- [Meta Help — About advertiser verification for ads transparency](https://www.facebook.com/business/help/983527276402621)
- [Meta Help — Request review of advertiser/payer issue](https://www.facebook.com/business/help/1024444835591336)
- [Graph API reference — beneficiary-payer (read-only)](https://developers.facebook.com/docs/graph-api/reference/beneficiary-payer/)

---

## 19. Erro OpenAI `billing_hard_limit_reached`

**Causa**: saldo OpenAI esgotou ou hard limit foi atingido. `gpt-image-2` falha; skill usa imagens stand-in.

**Fix**:

1. Abre https://platform.openai.com/account/billing
2. **Add to credit balance** ou **Increase hard limit**
3. Saldo recomendado: pelo menos $20 (cada imagem custa ~$0.02–$0.05, 3 imagens/run, 30 runs/mês ≈ $4–7/mês de imagens)

Próximo run automático usa o novo saldo.

---

## 20. Cron não disparou no horário esperado

**Sintoma**: `fly logs -a meta-agents-v3` não mostra `RUN_START` no horário esperado.

**Diagnóstico em ordem**:

1. **TZ do container**:
```bash
fly ssh console -a meta-agents-v3 -C "date"
```
Tem que aparecer `BRT` no fuso. Se aparecer `UTC`, o `Dockerfile` perdeu o `ENV TZ=America/Sao_Paulo` — corrige e re-deploy.

2. **Crontab presente**:
```bash
fly ssh console -a meta-agents-v3 -C "cat /app/crontab"
```

3. **Crontab válida**:
```bash
fly ssh console -a meta-agents-v3 -C "supercronic -test /app/crontab"
```

4. **supercronic vivo**:
```bash
fly ssh console -a meta-agents-v3 -C "ps aux | grep supercronic"
```

5. **Machine viva**:
```bash
fly status -a meta-agents-v3
```

Se algum desses falhar, restart:

```bash
fly machine restart $(fly machine list -a meta-agents-v3 --json | jq -r '.[0].id') -a meta-agents-v3
```

---

## 21. Skill exit=0 mas Ads Manager vazio

**Causa**: a skill é resiliente — termina com `exit=0` mesmo quando bloqueios externos impedem criação completa. O `exit=0` significa "skill terminou conforme contrato", não "campanha 100% criada".

**Diagnóstico**: olha o manifest pra ver qual bloqueio aconteceu:

```bash
fly ssh console -a meta-agents-v3 -C "cat /app/tentativas-geracao-de-campanhas/$(ls -t /app/tentativas-geracao-de-campanhas | head -1) | jq ."
```

Procura `"verified": false` e o array `"errors"` (ou `"blockers"` em versões antigas). Cada entrada tem `code`/`subcode` (ex: `100/3858634` = campos DSA faltando, ver [§18](#18-erro-meta-1003858634-verified-advertiser-missing); ou `openai_billing_hard_limit_reached`, ver [§19](#19-erro-openai-billing_hard_limit_reached)). Ataca o bloqueio correspondente.
