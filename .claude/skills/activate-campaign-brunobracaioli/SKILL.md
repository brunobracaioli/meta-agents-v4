---
name: activate-campaign-brunobracaioli
description: Ativa (coloca no ar — GASTO REAL) uma campanha de tráfego Meta Ads já existente do cliente brunobracaioli, de forma 100% autônoma e headless. Recebe `campaign_meta_id=<id>`, valida que a campanha é do cliente, está PAUSED e dentro do teto de orçamento, ativa campanha + ad sets + ads via MCP da Meta, persiste status='ACTIVE' e operation_logs no Supabase. Disparada pela fila `agent_jobs` (poll-agent-jobs.sh) quando o operador confirma a ativação pelo Ultron. NÃO cria campanha — só ativa uma existente.
argument-hint: "campaign_meta_id=120246500174380505"
allowed-tools: Read, Bash, Write, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ad_accounts, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_adsets, mcp__claude_ai_MCP_META_ADS_B2_TECH__list_ads, mcp__claude_ai_MCP_META_ADS_B2_TECH__update_campaign, mcp__claude_ai_MCP_META_ADS_B2_TECH__update_adset, mcp__claude_ai_MCP_META_ADS_B2_TECH__update_ad, mcp__supabase__execute_sql
---

# Skill: /activate-campaign-brunobracaioli

Ativa **uma campanha de tráfego já criada** (campanha + ad sets + ads, todos hoje
PAUSED) do cliente **brunobracaioli** — **a partir da ativação, a campanha vai ao ar e
passa a GASTAR DE VERDADE**. Esta skill é o par seguro da `create-traffic-…` (que nunca
ativa nada): aqui a ativação é o objetivo, sob limites duros.

> Disparada pelo runner Fly.io via a fila `agent_jobs` (`scripts/poll-agent-jobs.sh`),
> que só enfileira esta skill depois que o operador confirmou a ativação por voz no
> Ultron (confirmação em 2 turnos). Mesmo assim, **revalide tudo aqui** — este é o
> ator privilegiado; a confirmação de voz não substitui as checagens.

---

## 1. Modo de operação — AUTONOMIA TOTAL (leia primeiro)

Roda em **headless** (`claude -p`). Regras inegociáveis:

1. **NUNCA chame `AskUserQuestion`.** Em qualquer dúvida/erro, **decida sozinho** pelos
   limites abaixo, registre no manifest e siga; se não der para prosseguir com
   segurança, **aborte sem ativar** e grave o manifest com `verified:false`.
2. **Cliente é fixo: `brunobracaioli`.** Não generalize.
3. **Meta só via MCP da Meta. Persistência só via MCP do Supabase.**
4. **Limites duros (defesa em profundidade — abortam a ativação se violados):**
   - A campanha tem que **pertencer ao cliente** `brunobracaioli` (linha em `campaigns`
     com `client_id` do slug). Se não achar a campanha do cliente → **aborte**.
   - A campanha tem que estar **PAUSED** agora (no Supabase **e** na Meta). Se já estiver
     `ACTIVE` → não faça nada (idempotente, sucesso). Qualquer outro status → **aborte**.
   - **Orçamento diário ≤ 5000 cents (R$50)**. Se o daily budget da campanha (CBO) na
     Meta ou no Supabase exceder 5000 → **aborte sem ativar**.
   - Ative **somente** a campanha indicada e as entidades-filhas dela. Nunca ative
     outra campanha, nem altere orçamento, segmentação, criativo ou qualquer outra coisa.

---

## 2. Constantes do cliente

| Campo | Valor |
|---|---|
| slug | `brunobracaioli` |
| Ad Account | `225179730538661` (alias `act_225179730538661`) |
| Budget cap | `5000` cents (R$50/dia) · moeda `BRL` |

Faça lookup de `clients WHERE slug='brunobracaioli'` no Supabase para o `client_id`
(uuid) — **não hardcode o uuid**.

---

## 3. Argumento

- `campaign_meta_id` (**obrigatório**): o `meta_campaign_id` da campanha a ativar,
  vindo de `$ARGUMENTS` no formato `campaign_meta_id=<id>`. Se ausente ou não-numérico
  → aborte com manifest `verified:false` e `error:"campaign_meta_id ausente"`.

---

## 4. Passo a passo

### Passo 0 — Setup
- `DATE=$(TZ=America/Sao_Paulo date +%F)`, `STAMP=$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M)`.
- `TRY_DIR=tentativas-geracao-de-campanhas`; `mkdir -p "${TRY_DIR}"`.
- Extrair `campaign_meta_id` de `$ARGUMENTS` (parse de `key=value`). Validar que casa
  com `^[0-9]+$`. Caso contrário, abortar (Passo 6, `verified:false`).

### Passo 1 — Lookup e validação no Supabase (`mcp__supabase__execute_sql`)
```sql
select c.id            as campaign_uuid,
       c.client_id,
       c.name,
       c.status,
       c.daily_budget_cents,
       c.meta_campaign_id
  from public.campaigns c
  join public.clients cl on cl.id = c.client_id
 where cl.slug = 'brunobracaioli'
   and c.meta_campaign_id = '<campaign_meta_id>';
```
- Sem linha → **aborte** (`error:"campanha não encontrada para brunobracaioli"`). Nunca
  ative uma campanha que não está registrada como do cliente.
- `status='ACTIVE'` → **nada a fazer**; manifest `verified:true`, `already_active:true`.
- `status` diferente de `PAUSED` → **aborte** (`error:"status inesperado: <status>"`).
- `daily_budget_cents > 5000` → **aborte** (`error:"orçamento acima do teto"`).
- Guardar `client_id` e `campaign_uuid`.

Enumerar as entidades-filhas a ativar (mesma campanha):
```sql
select s.meta_ad_set_id, s.id as ad_set_uuid
  from public.ad_sets s
 where s.campaign_id = '<campaign_uuid>';

select a.meta_ad_id, a.id as ad_uuid
  from public.ads a
  join public.ad_sets s on s.id = a.ad_set_id
 where s.campaign_id = '<campaign_uuid>';
```

### Passo 2 — Revalidar na Meta (`list_campaigns`)
- `list_ad_accounts` → confirmar `225179730538661` ativo.
- `list_campaigns(account_id="225179730538661")` → localizar a campanha pelo `id`
  (= `campaign_meta_id`); confirmar `status`/`effective_status` **PAUSED** e ler o `daily_budget`
  (CBO). Se o budget vivo na Meta exceder 5000 cents → **aborte sem ativar** (mesmo que o Supabase
  diga ≤5000).

### Passo 3 — Ativar (campanha → ad sets → ads)
Uma campanha só entrega se a campanha **e** os ad sets **e** os ads estiverem ACTIVE.
Ative **de cima para baixo**, cada um via `update_*` com `status="ACTIVE"`:
1. Campanha: `update_campaign(campaign_id=<campaign_meta_id>, status="ACTIVE")`.
2. Cada ad set: `update_adset(adset_id=<meta_ad_set_id>, status="ACTIVE")` (Passo 1).
3. Cada ad: `update_ad(ad_id=<meta_ad_id>, status="ACTIVE")` (Passo 1).

Se algum nível falhar, **reverta o que já ativou para PAUSED** (`update_*` com `status="PAUSED"`),
registre o estado parcial em `errors[]` e em `operation_logs`, e finalize com `verified:false`.
(Diferente do MCP antigo, reverter agora é possível — não deixe a campanha entregando parcial.)

### Passo 4 — Validar (`list_*`)
- `list_campaigns`/`list_adsets`/`list_ads(account_id="225179730538661")` → confirmar
  `effective_status=ACTIVE` (ou `IN_PROCESS`, normal logo após ativar). Documentar.
- Se aparecer `WITH_ISSUES` em qualquer nível, registre no manifest (não é ativação limpa).

### Passo 5 — Persistir no Supabase (`mcp__supabase__execute_sql`)
- `update public.campaigns set status='ACTIVE' where meta_campaign_id='<id>';`
- `update public.ad_sets set status='ACTIVE' where campaign_id='<campaign_uuid>';`
- `update public.ads set status='ACTIVE' where ad_set_id in (select id from public.ad_sets where campaign_id='<campaign_uuid>');`
- **Uma linha por entidade ativada** em `operation_logs`:
  `client_id, entity_type ('campaign'|'ad_set'|'ad'), entity_id, meta_entity_id,
  action='activate', actor='ultron-trigger', summary` (humano, ex.: "Campanha [TRF][CCA]
  … ativada — gasto real iniciado, R$50/dia").

### Passo 6 — Manifest da run
Escrever `${TRY_DIR}/${STAMP}-ativacao.json`:
```json
{
  "skill": "activate-campaign-brunobracaioli",
  "client": "brunobracaioli",
  "date": "${DATE}",
  "verified": true,
  "campaign_meta_id": "...",
  "campaign_name": "...",
  "daily_budget_cents": 5000,
  "activated": {"campaign": true, "ad_sets": ["..."], "ads": ["..."]},
  "already_active": false,
  "errors": [],
  "ads_manager_url": "https://business.facebook.com/adsmanager/manage/campaigns?act=225179730538661"
}
```
Se abortou ou ativou parcialmente, `verified:false` + `errors[]` descritivo. **Sempre**
escreva o manifest — é o sinal que o runner/manifesto inspeciona.

### Passo 7 — Resumo final (stdout)
Tabela campanha / ad sets / ads com IDs e `effective_status`, link do Ads Manager, e a
frase: **"Campanha ATIVA — gasto real iniciado (R$50/dia)."** (ou o motivo do abort).

---

## 5. Critério de sucesso
- Campanha indicada (e seus ad sets/ads) com `effective_status` ACTIVE/IN_PROCESS na
  conta `225179730538661`.
- `list_*` sem `WITH_ISSUES` (ou erros documentados no manifest).
- `campaigns/ad_sets/ads.status='ACTIVE'` no Supabase + 1 `operation_logs action='activate'`
  por entidade.
- Manifest JSON gravado em `${TRY_DIR}/`.

## 6. Anti-padrões (NÃO faça)
- ❌ `AskUserQuestion` ou parar para pedir confirmação.
- ❌ Ativar campanha que não é do cliente `brunobracaioli` (sem linha em `campaigns`).
- ❌ Ativar campanha com `status` ≠ PAUSED, ou com daily budget > 5000 cents.
- ❌ Mudar orçamento, segmentação, criativo, nome ou qualquer coisa além do status.
- ❌ Ativar outras campanhas além da indicada.
- ❌ Ativar entidades sem persistir status + `operation_logs` no Supabase.

## 7. Gotchas
- **Gasto real**: diferente de toda outra automação do projeto, esta skill INICIA gasto.
  Por isso os limites duros do §1.4 abortam em qualquer ambiguidade. Em dúvida, **não
  ative**.
- **Entrega no Brasil bloqueada** — [[meta-br-advertiser-verification-blocker]]. As
  campanhas do projeto miram `["US"]` por causa do subcode `3858634`. A ativação não
  muda geo; se a Meta recusar a entrega por verificação de anunciante, registre em
  `errors[]` e `verified:false` — não tente "consertar" alterando a campanha.
- **Headless** — `.claude/HEADLESS.md`. Sem `AskUserQuestion`. Confiamos no contrato
  deste markdown e nos limites duros (R$50, só PAUSED→ACTIVE, só a campanha indicada).

## 8. Pré-requisitos
- MCP da Meta e MCP do Supabase autenticados (já feito no runner).
- A campanha já existe (criada pela `create-traffic-brunobracaioli-campaign`) e está PAUSED.
- Pasta `tentativas-geracao-de-campanhas/` (criada se faltar).
