---
name: create-traffic-<nome-cliente>-campaign
description: Cria campanha de tráfego completa (campaign + adset + 3 ads) para o cliente nome do cliente, headless-safe. Tudo PAUSED — nada vai ao ar sem ativação manual.
allowed-tools: Bash, Read, Grep, Glob, Write
---

# Skill: criar campanha de tráfego — nome do cliente

## CONTRATO HEADLESS — leia antes de qualquer ação

Esta skill é projetada para rodar em modo `claude -p` (não-interativo). Portanto:

- **NUNCA** chame `AskUserQuestion`. Sem confirmações. Sem perguntas. Decida com os defaults documentados abaixo.
- **NUNCA** ative campanhas, adsets ou ads. Tudo termina em `PAUSED`. Ativação é exclusivamente manual no Ads Manager.
- **NUNCA** ultrapasse R$ 50,00/dia por campanha (limite duro do cliente).
- **NUNCA** invente IDs de interesse. Use exclusivamente Advantage+ audience expansion (broad targeting).
- **SEMPRE** termine escrevendo o manifest JSON (item 7 do fluxo). Se falhou no meio, escreva o manifest com `error` e o que conseguiu criar — sem manifest a sessão é considerada falha.

## Inputs (defaults — não pergunte)

| Campo | Valor |
|---|---|
| URL da landing | `https://claude-code.cliente-site.io` |
| Ad Account ID | `225179730538661` |
| Facebook Page | `867347659802006` (Instagram vincula automático) |
| Materiais | `.claude/materiais-das-empresas/<nome-cliente>/` |
| Limite de orçamento | R$ 50,00/dia |

## Defaults da campanha (sem confirmação)

| Camada | Valor |
|---|---|
| Objetivo | `OUTCOME_TRAFFIC` |
| Optimization goal | `LANDING_PAGE_VIEWS` |
| Billing event | `IMPRESSIONS` |
| Bid strategy | `LOWEST_COST_WITHOUT_CAP` (CBO default) |
| Daily budget | `5000` (centavos = R$ 50,00) |
| Buying type | `AUCTION` |
| Special ad categories | `[]` |
| País | Brasil |
| Idade | 22-65 |
| Audience | Advantage+ broad (sem interest IDs) |
| Destination | `WEBSITE` |
| Status (todas camadas) | `PAUSED` |

## Naming convention (determinístico — para idempotência e rastreio)

Seja `YYYY-MM-DD` a data ISO de hoje.

- **Pasta de creativos**: `.claude/materiais-das-empresas/<nome-cliente>/generated-ads/cca-YYYY-MM-DD/`
- **Arquivos de imagem**: `ad-v1-autoridade.png`, `ad-v2-dor.png`, `ad-v3-oferta.png`
- **Pasta remota Supabase**: `nome-do-cliente/cca-YYYY-MM-DD-<unix-ts>/`
- **Campanha**: `[TRF][CCA][YYYY-MM-DD] Claude Code Architect — Traffic CBO`
- **AdSet**: `[ADSET][CCA][YYYY-MM-DD] Devs BR 22-65 — Advantage+ LPV`
- **Ads**:
  - `[AD][CCA][YYYY-MM-DD] v1 Autoridade — LEARN_MORE`
  - `[AD][CCA][YYYY-MM-DD] v2 Dor — LEARN_MORE`
  - `[AD][CCA][YYYY-MM-DD] v3 Oferta — SIGN_UP`

## Variantes de criativo (3 ads)

| # | Tema | CTA Meta |
|---|---|---|
| v1 | Autoridade (apresentação do produtor + prova) | `LEARN_MORE` |
| v2 | Dor (problema do público — vibe coding não escala) | `LEARN_MORE` |
| v3 | Oferta (bônus, garantia, próximo passo) | `SIGN_UP` |

## Fluxo (ordem obrigatória)

### 1. Scrape da landing
Delegue ao subagent `scrape-extractor` com a URL. Recebe brief estruturado (theme, value proposition, CTA, tom).

### 2. Geração paralela de prompts + copy
Em paralelo (uma única mensagem com 2 Agent calls):
- `image-prompt-generator` — recebe o brief + paths das referências visuais em `.claude/materiais-das-empresas/<nome-cliente>/` (logo, foto do produtor, exemplo de ad). Retorna 3 prompts (autoridade, dor, oferta) para 1:1 feed.
- `copywriter` — recebe o brief. Retorna 3 sets de copy: headline (≤40), primaryText (≤250), description (≤30), callToActionType per variante.

### 3. Geração das 3 imagens
Crie a pasta `generated-ads/cca-YYYY-MM-DD/`. Use a skill `image-generate` para gerar as 3 PNGs em paralelo (3 Bash backgrounds). Aguarde com `until` polling até as 3 existirem e `size > 0`. NÃO use `sleep` cego.

### 4. Upload Supabase Storage (service-role, não anon)
Faça `set -a; eval "$(tr -d '\r' < /mnt/c/agents_team_meta_ads_v3/.env.local)"; set +a` para carregar as vars. Use `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS — não depende de policy). Upload pra bucket `generated-images`, caminho `nome-do-cliente/cca-YYYY-MM-DD-$(date +%s)/<arquivo>.png`. Capture as 3 URLs públicas (`${SUPABASE_URL}/storage/v1/object/public/generated-images/<caminho>`).

### 5. Criação Meta Ads (4 chamadas MCP, na ordem)

5.1 `ads_create_campaign`:
- `ad_account_id`: `225179730538661`
- `campaign_name`: `[TRF][CCA][YYYY-MM-DD] Claude Code Architect — Traffic CBO`
- `objective`: `OUTCOME_TRAFFIC`
- `buying_type`: `AUCTION`
- `campaign_daily_budget`: `5000`
- `special_ad_categories`: `[]`
- (status default = PAUSED)

5.2 `ads_create_ad_set`:
- `ad_account_id`: `225179730538661`
- `campaign_id`: (id retornado em 5.1)
- `name`: `[ADSET][NEEDS-RETARGET-BR][CCA][YYYY-MM-DD] Devs 22-65 — Advantage+ LPV (US placeholder)`
- `optimization_goal`: `LANDING_PAGE_VIEWS`
- `billing_event`: `IMPRESSIONS`
- `destination_type`: `WEBSITE`
- `targeting`: `{"geo_locations":{"countries":["US"]},"age_min":22,"age_max":65,"targeting_automation":{"advantage_audience":1}}`
- `dsa_beneficiary`: `NOME-DO-PAGADOR`
- `dsa_payor`: `NOME-DO-PAGADOR`
- Status PAUSED

> **WORKAROUND ATIVO** (introduzido em 2026-05-22, ver [Runbook §18](../../../docs/how-to/operations-runbook.md#18-erro-meta-1003858634-verified-advertiser-missing) pro contexto completo): o targeting está em `US` como placeholder porque a Meta bloqueia criação de AdSet BR via Marketing API enquanto o advertiser/payer não está habilitado pra BR no backend (form de review pendente). Os campos `dsa_beneficiary`/`dsa_payor` ficam no payload mesmo no US — vão estar prontos pra quando o bloqueio cair.
>
> **Antes de ATIVAR a campanha** no Ads Manager o operador DEVE:
> 1. Editar o AdSet → mudar `Targeting → Countries` de `US` para `Brasil` (BR)
> 2. A UI da Meta vai forçar selecionar advertiser/payer no momento da edição — escolhe **Nome empresa** no dropdown
> 3. Salvar a edição
> 4. Conferir nome do AdSet e remover o prefixo `[NEEDS-RETARGET-BR]` se quiser
> 5. Só então ativar (Campaign → AdSet → Ads)
>
> **Quando o form de review for aprovado** (cliente reverificar advertiser/payer pra BR no backend), reverter este Step 5.2: mudar `"US"` → `"BR"` no targeting, e remover `[NEEDS-RETARGET-BR]` do nome do AdSet.

5.3 `ads_create_ad` x3 (uma por variante):
- `ad_account_id`: `225179730538661`
- `adset_id`: (id retornado em 5.2)
- `name`: conforme naming convention acima
- `creative_link_url`: `https://claude-code.cliente-site.io`
- `creative_image_url`: URL do Supabase pra essa variante
- `creative_page_id`: `867347659802006`
- `creative_message`: primaryText do copywriter
- `creative_link_title`: headline do copywriter
- `creative_link_description`: description do copywriter
- `creative_call_to_action_type`: conforme tabela de variantes (LEARN_MORE x2, SIGN_UP x1)
- Status PAUSED

### 6. Validação (read-only)
Chame `ads_get_ad_entities` com filtro `campaign.id = <id>` em level `ad`. Confirme que retornou 3 ads em status PAUSED. Se não, marque o manifest com `verified: false` e razão.

### 7. Manifest JSON (output obrigatório — SEM ISSO O RUN É FALHA)

Escreva em `tentativas-geracao-de-campanhas/YYYYMMDD-HHMM-trafego.json`:

```json
{
  "skill": "create-traffic-<nome-cliente>-campaign",
  "client": "<nome-cliente>",
  "createdAt": "2026-05-19T18:05:00-03:00",
  "adAccountId": "225179730538661",
  "campaignId": "120245...",
  "adSetId": "120245...",
  "ads": [
    { "id": "120245...", "variant": "autoridade", "cta": "LEARN_MORE", "imageUrl": "https://yluxllhibdvhnuvekkir.supabase.co/storage/v1/object/public/generated-images/nome-do-cliente/cca-2026-05-19-1778.../ad-v1-autoridade.png", "localPath": ".claude/materiais-das-empresas/<nome-cliente>/generated-ads/cca-2026-05-19/ad-v1-autoridade.png" },
    { "id": "120245...", "variant": "dor", "cta": "LEARN_MORE", "imageUrl": "...", "localPath": "..." },
    { "id": "120245...", "variant": "oferta", "cta": "SIGN_UP", "imageUrl": "...", "localPath": "..." }
  ],
  "budgetDailyCents": 5000,
  "status": "PAUSED",
  "verified": true,
  "needsRetarget": true,
  "retargetInstructions": "AdSet criado com targeting=US como placeholder (workaround do bloqueio Meta 100/3858634 — ver Runbook §18). Antes de ativar: edite targeting US→BR no Ads Manager UI, escolha Nome empresa no prompt advertiser/payer que vai aparecer, salve, então ative.",
  "adsManagerUrl": "https://business.facebook.com/adsmanager/manage/campaigns/edit?act=225179730538661&selected_campaign_ids=120245...",
  "errors": []
}
```

Quando o bloqueio `100/3858634` for resolvido (form de review aprovado) e o Step 5.2 voltar pra targeting BR direto, omitir `needsRetarget` e `retargetInstructions` do manifest.

Se houve falha parcial: preencha o que conseguiu, adicione `"errors": [{ "step": "5.3-ad-v2", "message": "..." }]` e `"verified": false`. Não tente "limpar" entidades parciais — campanha PAUSED não custa nada e é mais útil debugar no Ads Manager do que apagar evidência.

### 8. Output final
Imprima uma tabela markdown enxuta com IDs e status. **Inclua uma linha de aviso destacada lembrando o operador de editar targeting US→BR antes de ativar** (enquanto `needsRetarget` for true). Sem perguntas, sem sugestões de "ativar agora?".

## NUNCA faça

- ❌ Chamar `AskUserQuestion` (quebra `-p`)
- ❌ Chamar `ads_activate_entity` (ativação só manual)
- ❌ Ultrapassar `campaign_daily_budget: 5000`
- ❌ Inventar `interests` ou `behaviors` IDs no targeting
- ❌ Usar anon key + RLS policy pro upload — use sempre service-role
- ❌ Referenciar `/mnt/c/agents_team_meta_ads_v2/.env.local` (path morto)
- ❌ Dormir cego com `sleep 90`. Use `until [[ -s file ]]; do sleep 2; done`
- ❌ Continuar sem escrever o manifest do passo 7
