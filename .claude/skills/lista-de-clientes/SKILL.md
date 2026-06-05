---
name: lista-de-clientes
description: lista que contem das informações de clientes como id da BM, conta de anúncios, página do instagram, URLs, limites de orçamentos diários por campanha etc.
allowed-tools: Read, Bash
---

## Clientes
Nome: brunobracaioli
- Business Manager:  B2 Tech — `772813643612039`
- Ad Account:        `[brunobracaioli][cursos][3]` — `225179730538661`
- Facebook Page:     brunobracaioli — `867347659802006`
- URLs: https://b2tech.io, https://claude-code.b2tech.io, https://cca.b2tech.io 
- Orçamento máximo permitido para esse cliente: 50,00 reais por dia por campanha.
- materiais desse cliente estão em ".claude\materiais-das-empresas\brunobracaioli"
- Informações para traqueamento (IDs PÚBLICOS — defaults que semeiam toda landing page nova;
  o operador refina por LP na aba "Tracking" do editor). Listas (pode ter mais de um de cada):
  - `META_PIXELS=["653995666521954"]`
  - `GA4_IDS=["G-Z60CJ7W2Z8"]`
  - `GOOGLE_ADS_IDS=[]`
  > ⚠️ Apenas IDs PÚBLICOS ficam aqui (vão pro browser de qualquer forma). SEGREDOS de
  > conversão server-side (Meta CAPI access token, GA4 API secret, tokens do Google Ads)
  > **nunca** ficam neste arquivo nem no `settings.tracking` da LP — eles vão pra um cofre
  > isolado (tabela RLS-locked) que só o Worker lê. Ver ADR 0021 / SPEC-015 (Fase 2).

Nome: cliente
- Business Manager:  Nome empresa — `BM_ID`
- Ad Account:        `[brunobracaioli][cliente]` — `ADS_ACCOUNT_ID`
- Facebook Page:     Nome empresa — `FACEBOOK_PAGE_ID`
- URLs: https://cliente.ai
- Orçamento máximo permitido para esse cliente: 50,00 reais por dia por campanha.



