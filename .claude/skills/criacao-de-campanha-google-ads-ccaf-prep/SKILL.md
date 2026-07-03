---
name: criacao-de-campanha-google-ads-ccaf-prep
description: Fluxo completo, testado e seguro para criar campanhas de Pesquisa (Search) do CCA-F Prep (claudeprep.io) no Google Ads via MCP GOOGLE ADS B2 TECH. Use SEMPRE que o Bruno pedir para criar, montar, subir, lançar ou configurar campanha de Google Ads / Search / anúncios de pesquisa / tráfego pago para o CCA-F Prep, CCAF Prep, claudeprep.io, comunidade CCA-F, simulados CCA-F ou preparatório para a certificação Claude Certified Architect — mesmo que ele não diga "Google Ads" explicitamente. A skill já traz a copy validada do produto (headlines, descrições, keywords, sitelinks, callouts dentro dos limites), o orçamento padrão de R$ 20/dia e executa o funil correto (orçamento → campanha → ad group → RSA → keywords → sitelinks → callouts → geo → ativação), com os workarounds do wrapper, checagem anti-duplicação e conformidade de marca Anthropic. Acione esta skill ANTES de chamar qualquer tool de criação do Google Ads para este produto. Também roda headless via fila agent_jobs (kind=create_google_ads, `claude -p --dangerously-skip-permissions ".claude/skills/criacao-de-campanha-google-ads-ccaf-prep"`).
allowed-tools: Read, Bash, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__google_token_status, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_accessible_customers, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_campaigns, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_ad_groups, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__list_ads, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__generate_keyword_ideas, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_search_campaign, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_campaign_budget, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_campaign, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_ad_group, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_responsive_search_ad, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__add_keywords, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__add_negative_keywords, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_sitelinks, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__create_callouts, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__add_geo_targeting, mcp__claude_ai_MCP_GOOGLE_ADS_B2_TECH__add_age_targeting, mcp__supabase__execute_sql, mcp__supabase__list_tables
---

# Criação de Campanha Google Ads — CCA-F Prep

Skill operacional **específica de produto** para subir campanhas de Pesquisa do **CCA-F Prep** (comunidade de preparação para o Claude Certified Architect — Foundations) pelo MCP GOOGLE ADS B2 TECH. Deriva da skill agnóstica `criacao-de-campanha-google-ads`; o método e os guardrails são os mesmos — aqui o produto, a copy e os defaults já vêm resolvidos.

## Ficha do produto (defaults desta skill)

| Parâmetro | Valor |
|---|---|
| Produto | CCA-F Prep — Comunidade + simulados + mentorias (12 meses) |
| URL final | `https://claudeprep.io/` |
| Orçamento diário | **R$ 20,00/dia** |
| Estratégia de lance | `TARGET_SPEND` (maximizar cliques) |
| Match type | `PHRASE` |
| Geo | Brasil `["2076"]` |
| Idioma (keyword ideas) | `language_id: "1014"` (pt-BR) |
| Conta | `customer_id: 4342319594` (Blog B2 Tech, BRL) |
| Display path | `path1: "cca-f"` · `path2: "prep"` |
| Nome da campanha | `CCAF Prep - Search - TARGET_SPEND \| {DD/MM HH:MM}` |

Oferta vigente (confirme se mudou antes de subir): founder **R$ 2.497** ou 12x R$ 249,70 · 240 questões · 6 cenários · mentorias semanais · 12 meses de acesso. A copy pronta está em `references/copy-ccaf-prep.md` — **leia antes de montar a chamada**.

Se o Bruno pedir campanha para **outro produto**, esta skill não se aplica — use a skill agnóstica `criacao-de-campanha-google-ads`.

## Princípios inegociáveis

- **Preview antes de criar, sempre.** Toda tool de criação aceita `preview: true` — rode primeiro para validar limites e estrutura server-side, depois `preview: false`. Vale para campanha, sitelinks e callouts.
- **Tudo nasce PAUSED.** O funil cria tudo pausado; nada gasta até ativação explícita. Ativar é passo separado e exige confirmação.
- **O funil NÃO é atômico.** Se um passo falha no meio, os recursos já criados não sofrem rollback — voltam no retorno como `resource_names` inertes. Reaproveite-os no retry; nunca recrie do zero.
- **Confirmar antes de gastar.** Ativação, mudança de orçamento ou geo exigem o "ok" do Bruno. Apresente o plano, espere a confirmação.

## Modo headless (fila agent_jobs — kind `create_google_ads`)

Quando disparada pelo runner (`claude -p`, job enfileirado pelo Ultron), **não há humano
para responder**. Regras que SUBSTITUEM os pontos interativos desta skill:

1. **NUNCA chame `AskUserQuestion`** nem pare esperando confirmação — deadlock. Todas as
   frases "confirme com o Bruno / espere o ok" valem só no modo interativo. No headless,
   **os defaults da ficha do produto valem integralmente** (R$ 20/dia, TARGET_SPEND,
   PHRASE, BR, copy de `references/copy-ccaf-prep.md`).
2. **Anti-dup vira término gracioso.** Se o pré-flight achar campanha com `CCAF Prep` ou
   `CCA-F Prep` no nome com status ENABLED **ou** PAUSED criada há menos de 7 dias, NÃO
   crie nada: grave um `operation_logs` com `action='skip'` e `summary` explicando qual
   campanha já existe, e **encerre com exit 0** (isso é sucesso, não falha).
3. **NUNCA ative nada.** Pule o passo de ativação por completo (as tools `update_*_status`
   nem estão no `allowed-tools`). A campanha fica PAUSED; ativação é manual do Bruno.
4. **Persista em `operation_logs`** (via `mcp__supabase__execute_sql`, padrão da
   create-sales): **uma linha por entidade criada** — `client_id` (do brunobracaioli),
   `entity_type` (`campaign`), `meta_entity_id` = resource_name do Google
   (ex.: `customers/4342319594/campaigns/123`), `action='create'`, `actor='claude-code'`,
   `summary` humano (ex.: "Campanha Google Ads Search CCAF Prep R$20/dia criada PAUSED,
   10 keywords, 6 sitelinks, 6 callouts, 12 negativas, geo BR"). **NÃO** grave nas tabelas
   `campaigns/ad_sets/ads` — o schema delas é específico da Meta.
5. **Erro no meio do funil**: siga o workaround do Caminho B reaproveitando os
   `resource_names` já criados. Se ainda assim não der para concluir sem violar um limite,
   grave `operation_logs` com `action='error'` + o `request_id`, e saia com exit ≠ 0 —
   nunca deixe recurso órfão sem registro.

## ⚠️ Conformidade de marca (específico deste produto)

O CCA-F Prep é um **preparatório independente** — não é afiliado, endossado nem patrocinado pela Anthropic. Isso vale também para os anúncios:

- **Nunca** use copy que implique oficialidade: nada de "certificação oficial da B2 Tech", "curso oficial Anthropic", "parceiro oficial do exame" em headlines/descrições/sitelinks.
- Pode citar nominativamente "CCA-F", "Claude Certified Architect" e "Anthropic" como **referência ao exame** (uso nominativo), como a copy validada já faz.
- Se o Google reprovar algum asset por trademark, não brigue com variação de grafia — reporte ao Bruno; a decisão de contestar é dele (envolve os termos do Partner Network).
- A landing já carrega o disclaimer legal; os anúncios devem apontar só para `https://claudeprep.io/`.

## Intake — confirme antes de tocar em qualquer tool

Os defaults acima cobrem o caso padrão. Confirme com o Bruno, numa única pergunta consolidada, apenas o que fugir deles (orçamento diferente de R$ 20, outra estratégia de lance, geo restrito, teste A/B, etc.). Se ele só disse "sobe a campanha do CCAF Prep", os defaults valem.

## ⚠️ Pré-flight anti-duplicação (não pule)

Antes de criar qualquer coisa, rode `list_campaigns` na conta `4342319594` e verifique:

1. **Já existe campanha do CCA-F Prep / claudeprep.io?** Se sim, não duplique — pergunte ao Bruno se quer editar a existente, criar variante (ad group novo, teste A/B) ou seguir mesmo assim. Atenção: pode existir campanha antiga do produto apontando para domínio anterior — se achar, pergunte se pausa/atualiza a antiga.
2. **O nome do orçamento é derivado do nome da campanha.** Nome repetido → budget colide → funil quebra no passo budget/campaign. Garanta nome único incluindo data + hora: `CCAF Prep - Search - TARGET_SPEND | {DD/MM HH:MM}`.
3. **Não há `list_budgets` exposta.** Se suspeitar de budget órfão de um run anterior que falhou no meio, use o `resource_name` retornado naquele run para reaproveitá-lo no Caminho B, em vez de criar outro.

Pular este passo já levou um Claude a tentar recriar uma campanha que estava ENABLED e gastando. Não pule.

## Conta e estratégia de lance

- Conta de operação: `customer_id: 4342319594` (Blog B2 Tech, BRL). Passe `customer_id` explicitamente sempre. A `1720061401` é manager/restrita — **não veicule nela**.
- Default do produto: `TARGET_SPEND`. Se o Bruno pedir outra coisa: max conversões → `MAXIMIZE_CONVERSIONS` · max valor de conversão → `MAXIMIZE_CONVERSION_VALUE` · CPC manual → `MANUAL_CPC`.

## Fluxo completo (ordem obrigatória)

### Caminho A — `create_search_campaign` (all-in-one, preferido)

Monta budget → campaign → ad group → targeting → keywords → RSA numa chamada. Use a copy de `references/copy-ccaf-prep.md`: `campaign_name` (com data+hora), `ad_group_name` (ex: `CCA-F Prep - Certificação`), `budget_amount: 20`, `final_urls: ["https://claudeprep.io/"]`, headlines (15), descriptions (4), keywords (PHRASE), `geo_target_ids: ["2076"]`, `path1: "cca-f"`, `path2: "prep"`. Rode em `preview: true`, depois `preview: false`.

#### ⚠️ Workaround — bug no passo campaign

Há histórico do passo campaign falhar com `"The required field was not present."` (erro genérico da Google Ads API, não nomeia o campo; independe da bidding_strategy). Quando ocorre:

1. O orçamento já foi criado e retorna em `completed[]` — anote o `resource_name`.
2. **Não recrie o orçamento.** Vá para o Caminho B reaproveitando esse budget.
3. Se o `create_campaign` standalone também falhar igual, é bug do wrapper (campo obrigatório omitido na mutation). Reporte ao Bruno com o `request_id` para corrigir o servidor; depois retome do passo que falhou.

### Caminho B — funil manual (retry/controle)

Cada passo retorna o `resource_name` que alimenta o próximo:

1. `create_campaign_budget` → `campaignBudgets/{id}`
2. `create_campaign` (budget_resource_name) → `campaigns/{id}`
3. `create_ad_group` (campaign_resource_name) → `adGroups/{id}`
4. `create_responsive_search_ad` (ad_group_resource_name + copy + paths)
5. `add_keywords` (ad_group_resource_name, `match_type: PHRASE`)

### Extensões — após o funil

- `create_sitelinks` (campaign_resource_name, lista de `references/copy-ccaf-prep.md`) — cria e linka numa chamada. Preview primeiro.
- `create_callouts` (campaign_resource_name, lista) — idem.

Assets ficam a nível de campanha (campaignAssets), valem para todos os ad groups. Não-atômicos: se o link falhar, os assets voltam no retorno e são reutilizáveis.

### Negativas — obrigatórias neste produto

O termo "cca-f"/"certificação claude" atrai busca informacional e caçador de material grátis. Após o funil, aplique `add_negative_keywords` a nível de campanha com a lista de negativas da copy (grátis, download, dumps, etc.). Se a tool não estiver exposta na versão corrente do MCP, avise o Bruno para aplicar no Ads Manager — deixe registrado no quadro final como item em aberto.

### Geo e ativação

1. `add_geo_targeting` (campaign_resource_name, `["2076"]`). Sem geo a campanha roda global e queima os R$ 20 com clique internacional — **sempre trave Brasil**. Pode aplicar com a campanha já ativa.
2. (Opcional) `add_age_targeting` no ad group.
3. **Ativação — só após confirmação.** Os três níveis nascem PAUSED:
   - `update_campaign_status` (active, `confirm: true`)
   - `update_ad_group_status` (active, `confirm: true`)
   - `update_ad_status` (ad_group_id + ad_id, active, `confirm: true`)

## Limites de caractere (respeite ou toma erro de validação)

| Asset | Campo | Limite |
|---|---|---|
| RSA | headline | ≤ 30 char (3–15 títulos) |
| RSA | description | ≤ 90 char (2–4 descrições) |
| Sitelink | text | ≤ 25 char |
| Sitelink | description1/description2 | ≤ 35 char cada — both-or-neither |
| Callout | frase | ≤ 25 char (até 20) |
| Ad path | path1/path2 | ≤ 15 char cada |

Acento conta como 1 caractere. A copy do produto já foi conferida contra esses limites — se editar qualquer asset, reconfira. Na dúvida, o preview confirma.

## DKI — já embutida na copy

A copy validada usa 3 headlines com Inserção Dinâmica de Palavra-chave: `{KeyWord:Simulado CCA-F}`, `{KeyWord:Certificação Claude}` e `{KeyWord:Curso CCA-F Prep}`. Regras se for mexer:

- Texto padrão (depois dos `:`) ≤ 30 char — é o fallback quando a keyword não cabe.
- `{KeyWord:...}` = Title Case, padrão para headlines. Em descrição use `{Keyword:...}` (sentence case).
- O ad group é temático (certificação CCA-F), então a inserção lê gramaticalmente. Se criar ad group novo com keywords de outro tema, revise se as DKI ainda fazem sentido.
- Nunca use DKI em todos os títulos — o RSA precisa de fixos de marca/oferta.

## Pesquisa de keywords (`generate_keyword_ideas`)

A lista base está na copy. Para expandir/dimensionar:

- Sem paginação — controle por `limit` (máx 1000).
- Use `geo_target_ids: ["2076"]` + `language_id: "1014"`.
- Multi-seed cirúrgico > seed amplo. Seeds bons para este produto: "certificação claude", "claude certified architect", "simulado cca-f", "certificação anthropic", "certificação de ia". Evite seeds genéricos ("inteligência artificial") — devolvem ruído informacional e CPC altíssimo.
- Sempre cheque o lance de topo antes de adotar keyword nova: termo caro zera R$ 20/dia num clique.
- Nicho pequeno (menos de 100 certificados no BR): volumes baixos são esperados. Não infle a lista com termo genérico de IA só para ter volume — melhor pouco tráfego qualificado do que budget queimado.

## Fechamento

Termine sempre com um quadro do estado (campanha/RSA/keywords/sitelinks/callouts/negativas/geo + status). Lembre que os assets passam por revisão do Google (algumas horas) antes de servir — e que termos de marca de terceiros podem levar a revisão manual. Aponte itens em aberto (geo não travado, negativas pendentes, etc.). **Nunca ative sem confirmação explícita.**