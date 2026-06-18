# 0029 — Migração das skills da Meta para o connector próprio MCP_META_ADS_B2_TECH

- **Status:** accepted
- **Data:** 2026-06-18
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** ADR 0003 (bucket público ad-ingest), ADR 0023 (vídeo via /advideos),
  ADR 0025 (funnel-analytics b2tech)

## Context

O projeto operava a Meta via o connector oficial `meta-ads-mcp` / `Meta_Ads_MCP`
(`mcp__claude_ai_Meta_Ads_MCP__ads_*`). O operador **criou um MCP próprio**
(`MCP_META_ADS_B2_TECH`, Graph v25, token persistido no Supabase) e **desativou o oficial**.

Com isso, as skills/config acoplados ao connector antigo ficaram quebrados ou divergentes:

- `create-traffic-brunobracaioli-campaign` e `activate-campaign-brunobracaioli` chamavam
  `Meta_Ads_MCP__ads_*` (desativado) → **quebradas**.
- `create-sales-brunobracaioli-campaign` usava `META_ADS_MCP_B2_TECH` (nome divergente).
- `funnel-analytics-brunobracaioli-campaign` usava a variante `mcp-meta-ads-b2tech`.
- `analytic-traffic-brunobracaioli-campaign` (deprecated) usava `Meta_Ads_MCP`.
- `.claude/settings.json` (hooks/permissions) e `.claude/hooks/emit-agent-event.py`
  (classifier de telemetria) casavam em `ads_create_campaign`/`ads_*`. Com os nomes novos
  (sem prefixo `ads_`) o hook de telemetria não dispararia e o HUD ao vivo ficaria cego.

O MCP novo foi **validado E2E em 2026-06-18**: campanha + ad set + 3 creatives + 3 ads PAUSED
criados na conta `act_225179730538661`, custo Meta = 0 (ver
`tentativas-geracao-de-campanhas/20260618-1218-teste-mcp-novo.log`).

## Decision

Padronizar **todas** as superfícies da Meta no connector `MCP_META_ADS_B2_TECH`:

1. **Skills** (`create-traffic`, `activate`, `create-sales`, `funnel-analytics`,
   `analytic-traffic`): `allowed-tools` e corpo reapontados pro prefixo
   `mcp__claude_ai_MCP_META_ADS_B2_TECH__*`.
2. **Fluxo de criação em 2 etapas**: `create_creative(image_url=<URL pública>)` → `create_ad(creative_id)`,
   substituindo o ad inline com `object_story_spec.link_data.picture` do MCP antigo
   (`create_creative` do MCP novo aceita `image_url` público direto — sem `image_hash`).
3. **Ativação** via `update_campaign/update_adset/update_ad(status="ACTIVE")` (top-down), no lugar
   de `ads_activate_entity`. Reverter agora é possível (`status="PAUSED"`/`pause_*`).
4. **Validação** via `list_*` (`effective_status` `IN_PROCESS`/`WITH_ISSUES`), já que o MCP novo
   não tem `ads_get_errors`/`ads_get_field_context`.
5. **settings.json**: allowlist + matchers dos hooks (`PreToolUse`/`PostToolUse`) ampliados pros
   nomes novos (`create_*`/`update_*`/`pause_*`/`list_*`/`get_insights`).
6. **Classifier de telemetria** (`emit-agent-event.py`, reusado por `emit-from-stream.py`): novas
   regras de substring, com ordem `*_adset`/`*_campaign`/`*_creative` antes de `*_ad`.
7. **Upload pro Storage `ad-ingest`**: usar `SUPABASE_SECRET_KEY` (formato `sb_secret_`, não-JWT) no
   header `apikey` (Bearer sozinho dá 403 "Invalid Compact JWS").

## Consequences

**Positivas**
- Fluxo de criação/ativação volta a funcionar com o connector ativo.
- `create_creative(image_url)` elimina o workaround de imagem inline.
- Ativação reversível (rollback de ativação parcial).
- HUD ao vivo volta a refletir as tools da Meta (classifier + matcher atualizados).

**Negativas / riscos**
- O connector novo precisa estar **autenticado no runner Fly headless** (token no Supabase) —
  pré-requisito operacional; sem isso as skills falham no cron. Validar pós-deploy.
- `analytic-traffic` (deprecated) perde as tools de benchmark/anomalia (não existem no MCP novo);
  fica reapontada só pra resolver, com a implementação canônica na `funnel-analytics`.
- ADRs/specs históricos seguem citando os nomes antigos como registro point-in-time.

## Verificação
- Grep de regressão (`Meta_Ads_MCP`, `ads_create_/activate_/get_`, `META_ADS_MCP_B2_TECH`,
  `mcp-meta-ads-b2tech`) zerado nas 5 skills.
- Teste do classifier com os nomes novos (incl. `create_adset` ≠ `create_ad`).
- Re-run de `create-traffic` (idempotência do dia reusa criativos → sem custo de imagem) confirmando
  árvore PAUSED via `list_*` + persistência no Supabase.
- `funnel-analytics` (read-only) retornando insights no connector novo.
