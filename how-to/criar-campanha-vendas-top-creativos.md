# How-to — Criar uma campanha de vendas reusando os top creativos (via MCP)

> **Objetivo:** subir uma campanha de **vendas (conversões/compra)** que reaproveita
> os criativos que mais venderam, otimizando por pixel, usando as tools do MCP
> "META ADS MCP B2 TECH".
>
> **Quando usar:** você já tem ads vencedores numa conta e quer escalar/recombinar
> esses mesmos criativos numa campanha nova, sem recriar arte nem copy.
>
> **Público deste doc:** humano operando o MCP **e** base para construir uma *skill*
> que automatize o fluxo em outro projeto. Por isso ele é explícito sobre erros,
> causas e correções — uma skill precisa saber reagir a cada um.

Este guia foi escrito a partir de uma execução real (15/jun/2026) que esbarrou em
três bloqueios da Meta. Todos os "achados" estão documentados abaixo.

---

## 0. Princípio que economiza horas

> **Os erros "Invalid parameter" da Graph API quase nunca são bug do MCP — são
> regras de negócio/identidade da Meta.** O passo mais valioso foi fazer o MCP
> **expor a mensagem real** da Meta (`error_user_msg` + `subcode`). Sem isso, todo
> erro parece igual e você fica chutando. Com isso, cada erro vira uma instrução.

Se for criar uma skill: **logue/propague sempre `error_user_msg` e `error_subcode`**.
Eles são a chave de todo o tratamento de erro abaixo.

---

## 1. Pré-requisitos (cheque ANTES de começar)

| Requisito | Como verificar | Se faltar |
|---|---|---|
| Token válido com `ads_management` | `meta_token_status` → `is_valid:true`, scopes inclui `ads_management` | rode `meta_login` |
| **Pixel** ativo da conta | é o `pixel_id` que os ad sets de venda existentes usam | confirme com o cliente |
| **Permissão de Anunciante na Página** | o usuário do token tem a task *Advertise* na Página que os criativos publicam | adicionar a Página/permissão no Business Manager |
| **Anunciante DSA confirmado** (se for mirar UE/BR) | Business Settings → Regulamentações da UE / Informações do anunciante | confirmar o anunciante, ou mirar US temporariamente |

As duas últimas linhas são **gates de identidade** da Meta — não dá pra contornar
por parâmetro. Veja a seção 5.

---

## 2. Visão geral do fluxo

```
insights (nível ad)  →  escolher vencedores  →  pegar creative_id
        │
        ▼
create_campaign (SALES + CBO)
        │
        ▼
create_adset (OFFSITE_CONVERSIONS + pixel + público amplo)
        │
        ▼
create_ad × N   (um por creative vencedor)
        │
        ▼
verificar (list_campaigns / list_adsets / list_ads)
```

Hierarquia: **Campanha → Ad set → Ads**. Orçamento mora na campanha (CBO).

---

## 3. Passo a passo

### Passo 3.1 — Descobrir os vencedores e seus `creative_id`

1. `get_insights` com `level:"ad"`, `date_preset` do período (ex.: `this_month`),
   `fields` incluindo `ad_id,ad_name,spend,actions,action_values,purchase_roas`.
2. Filtre os ads cujo `actions` contém `omni_purchase` (ou `purchase`). Ordene por
   nº de compras / receita / ROAS.
3. `list_ads` para mapear cada `ad_id` vencedor → `creative.id` (o **`creative_id`**).

> ⚠️ **Achado:** o mesmo *nome* de ad (ex.: `ads-1-ultron`) costuma corresponder a
> **`creative_id` diferentes**. Sempre use o ID, nunca o nome.

> 💡 Respostas grandes do `get_insights`/`list_ads` podem estourar o limite de
> tokens e serem salvas em arquivo — consulte com `jq` em vez de ler tudo.

### Passo 3.2 — Criar a campanha (SALES + CBO)

```jsonc
// create_campaign
{
  "account_id": "act_XXXXXXXXXX",
  "name": "Vendas-Advantage-TopCreatives-<data>",
  "objective": "OUTCOME_SALES",
  "special_ad_categories": ["NONE"],   // obrigatório; ["NONE"] se nada se aplica
  "daily_budget": 5000,                 // CENTAVOS → R$50,00 (CBO na campanha)
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "status": "PAUSED"                    // suba PAUSED e ative quando revisar
}
```

Guarde o `id` retornado (= `campaign_id`).

### Passo 3.3 — Criar o ad set (otimizado para compra)

```jsonc
// create_adset
{
  "account_id": "act_XXXXXXXXXX",
  "name": "ABO-amplo-advantage-purchase",
  "campaign_id": "<campaign_id>",
  "optimization_goal": "OFFSITE_CONVERSIONS",
  "billing_event": "IMPRESSIONS",
  "promoted_object": { "pixel_id": "<PIXEL_ID>", "custom_event_type": "PURCHASE" },
  "targeting": {
    "geo_locations": { "countries": ["US"] },   // veja seção 5: BR pode ser bloqueado
    "age_min": 18,
    "age_max": 65,
    "targeting_automation": { "advantage_audience": 1 }   // público Advantage+
  },
  "dsa_beneficiary": "<RAZÃO SOCIAL DO ANUNCIANTE>",
  "dsa_payor": "<RAZÃO SOCIAL DO ANUNCIANTE>",
  "status": "PAUSED"
}
```

Pontos que **fazem diferença**:

- **NÃO envie `destination_type`.** Veja o achado #1 (seção 5).
- **Sem `daily_budget` no ad set** — o orçamento é da campanha (CBO).
- `advantage_audience: 1` + só geo/idade = "público amplo Advantage+".
- Sem `publisher_platforms` no `targeting` ⇒ **posicionamentos automáticos** (Advantage+).

Guarde o `id` retornado (= `adset_id`).

### Passo 3.4 — Criar os ads (um por creative vencedor)

```jsonc
// create_ad  (repita para cada creative_id)
{
  "account_id": "act_XXXXXXXXXX",
  "name": "demiti-agencia (3 vendas)",
  "adset_id": "<adset_id>",
  "creative_id": "<CREATIVE_ID_VENCEDOR>",
  "status": "ACTIVE"
}
```

> 💡 Reusar `creative_id` **preserva a copy e o Advantage+ creative** já embutidos
> no criativo vencedor — você não recria nada.

São chamadas independentes ⇒ podem ir em **paralelo**.

### Passo 3.5 — Verificar

- `list_campaigns` → a campanha aparece com `daily_budget` e `bid_strategy` corretos.
- `list_adsets` → ad set com `optimization_goal:OFFSITE_CONVERSIONS` e o `promoted_object` (pixel).
- `list_ads` → os N ads no ad set.

---

## 4. Árvore de decisão: país-alvo e DSA

```
Quer mirar Brasil (ou UE)?
├── Sim → a conta tem um ANUNCIANTE DSA CONFIRMADO no Business Manager?
│        ├── Sim → use dsa_beneficiary/dsa_payor = nome EXATO confirmado → cria BR ✔
│        └── Não → bloqueio "verified advertiser" (subcode 3858634)
│                  → opção A: confirmar o anunciante na Meta e repetir
│                  → opção B: criar com countries:["US"] e trocar p/ BR manualmente depois
└── Não (US/outros) → cria direto (sem o gate DSA) ✔
```

---

## 5. Achados — erros encontrados, causa e correção

> Tabela pensada para virar o **tratamento de erro de uma skill**: casar pelo
> `subcode`/`error_user_msg` e aplicar a correção.

| # | Erro (subcode) | Causa real | Correção |
|---|---|---|---|
| 1 | `Invalid parameter` ao criar ad set | enviamos `destination_type:WEBSITE`, que a Meta **rejeita** em ad sets `OUTCOME_SALES` v25 | **Omitir `destination_type`** (ad sets que funcionam ficam `UNDEFINED`) |
| 2 | `Advertiser is missing — Provide a verified advertiser` (**3858634**) | targeting **BR** sob enforcement DSA novo; exige **anunciante confirmado**. `dsa_beneficiary`/`dsa_payor` como texto livre **não** basta | confirmar anunciante no Business Manager **ou** mirar **US** temporariamente e migrar depois |
| 3 | `No Advertiser Permission On Page` (**1885499**) | o usuário do token **não tem a task *Advertise*** na Página que o creative publica | conceder permissão de Anunciante na Página (Business Manager) e repetir o `create_ad` |

Observações que sustentam os achados:

- Ad sets de venda **criados ≤ 14/jun funcionam sem DSA** (grandfathered); os criados
  a partir de ~15/jun caem no gate. Enforcement é recente e vale para objetos **novos**.
- O diagnóstico veio de **comparar com um ad set que já funciona** (ler `promoted_object`,
  `targeting`, `destination_type`) em vez de tentar variações às cegas.

---

## 6. Achados operacionais (MCP ↔ claude.ai ↔ Vercel)

- **Deploy que muda *schema* de tool ⇒ reconectar o connector.** O claude.ai cacheia o
  `tools/list` na conexão; novos parâmetros só aparecem após reconectar (ou nova sessão).
  Mudança **só de comportamento** (ex.: melhorar mensagem de erro) **não** exige reconectar.
- **`vercel --prod` sobe o working tree local, não o git** — mantenha `main` ↔ prod em sincronia.
- O **prefixo das tools muda** a cada reconexão/renome do connector
  (`B2_Tech_Meta_Ads` → `MCP_META_PRO_B2TECH` → `META_ADS_MCP_B2_TECH`); recarregue o schema.
- Para purchase optimization, o MCP precisou ganhar: `promoted_object`, `bid_strategy`,
  `dsa_beneficiary`/`dsa_payor` no `create_adset` (e `bid_strategy` no `create_campaign`),
  além de **expor `error_user_msg`/subcode**. Ver ADR 0011.

---

## 7. Guardrails ao automatizar (para a skill)

Uma skill que executa este fluxo deve, no mínimo:

1. **Confirmar com o usuário antes de gastar:** orçamento, status (PAUSED vs ACTIVE) e
   seleção de creatives são decisões de dinheiro — não assuma.
2. **Default seguro = PAUSED.** Crie pausado e só ative após revisão. Especialmente se
   usar o workaround de país (US) — ativar com país errado **queima orçamento**.
3. **Pré-cheques antes de criar:** token válido, permissão de Página, e (se BR/UE)
   anunciante DSA. Falhar cedo com mensagem clara > falhar no meio com objetos órfãos.
4. **Tratar os 3 erros da seção 5 por `subcode`** com a correção/mensagem correspondente.
5. **Idempotência/limpeza:** se o ad set criar mas os ads falharem, não recriar o ad set
   — reusar o `adset_id`. (Ad sets/ads que falham na criação **não** deixam objeto órfão.)
6. **Reportar com fidelidade:** IDs criados, o que ficou PAUSED, e os passos manuais
   pendentes (ex.: trocar país US→BR e ativar).

---

## 8. Checklist rápido

- [ ] `meta_token_status` ok (`ads_management`)
- [ ] vencedores → `creative_id` mapeados (`get_insights` ad-level + `list_ads`)
- [ ] permissão de Anunciante na Página garantida
- [ ] `create_campaign` (SALES + CBO + `bid_strategy`)
- [ ] `create_adset` (**sem `destination_type`** + pixel/PURCHASE + advantage + DSA; país conforme seção 4)
- [ ] `create_ad` × N (por `creative_id`)
- [ ] `list_*` confere a estrutura
- [ ] reportar IDs + pendências manuais

---

## Apêndice — Valores "conhecidos-bons" (do caso real)

| Campo | Valor que funcionou |
|---|---|
| `objective` | `OUTCOME_SALES` |
| `bid_strategy` | `LOWEST_COST_WITHOUT_CAP` |
| `optimization_goal` | `OFFSITE_CONVERSIONS` |
| `billing_event` | `IMPRESSIONS` |
| `promoted_object` | `{ "pixel_id": "...", "custom_event_type": "PURCHASE" }` |
| `destination_type` | **(omitido)** |
| `targeting` (amplo) | `{ "geo_locations": {"countries":["US"]}, "age_min":18, "age_max":65, "targeting_automation": {"advantage_audience":1} }` |
| budget | na **campanha** (CBO), em **centavos** |

Ver também: `docs/reference/mcp-tools.md` (contrato das tools) e
`docs/adr/0011-pixel-conversion-optimization-on-adsets.md` (decisão de design).
