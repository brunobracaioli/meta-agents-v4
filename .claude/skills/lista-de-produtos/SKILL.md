---
name: lista-de-produtos
description: Catálogo de produtos por cliente (curso, imersão, serviço) com slug, preço, checkout, subdomínio padrão e o caminho do brief JSON completo. Use para descobrir quais produtos um cliente tem e onde está o brief que alimenta a geração de landing pages (create-landing-page-*) e de campanhas. O brief estruturado (dores, mecanismo, oferta, autoridade, números, agenda) vive em .claude/materiais-das-empresas/<cliente>/produtos/<slug>.json e é lido headless via Read.
allowed-tools: Read, Bash, Glob
---

# Catálogo de produtos

Índice human/agent-readable dos produtos por cliente. **Fonte da verdade do brief** = o
arquivo JSON apontado em cada produto (`.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`),
lido via `Read` (funciona headless no runner Fly — o `.claude/` é COPY-ado para a imagem;
o MCP do Supabase **não** autentica headless). Ver ADR 0014.

Cada brief JSON tem: identidade (slug, name, shortCode, tagline, positioning, tone),
`offer` (priceCents, anchorPriceCents, checkoutUrl, waitlistUrl, cartState, deadline,
payments, guarantee, scarcity), conteúdo de copy (dores, mecanismo, stack, prereqs, agenda,
entregaveis, persona, comparison, autoridade, numeros, faqHints), `seo`, `assets` e `brand`.

A skill `create-landing-page-brunobracaioli` recebe `product=<slug>`, lê o brief
correspondente e passa para os subagents `landing-page-architect` + `lp-copywriter`.

---

## Cliente: brunobracaioli

### `cca` — Claude Code Architect (status: active)
- Tipo: curso pt-BR (dev / engenharia agêntica)
- Preço: R$ 1.497,00 (`priceCents=149700`) · à vista
- Checkout: `https://pay.hub.la/KiIZ2UcpwcbOps224hbI`
- Subdomínio padrão: `cca` → `cca.b2tech.io`
- Brief: `.claude/materiais-das-empresas/brunobracaioli/produtos/cca.json`

### `imersao-agencia` — Imersão AgêncIA Tráfego Pago (status: active)
- Tipo: workshop ao vivo (agência de Meta Ads operada por agentes de IA)
- Data: 20/06/2026, 13h–18h (5h), ao vivo no Zoom, com gravação
- Preço: R$ 147,00 (`priceCents=14700`) · 1º lote, à vista · âncora R$ 497
- Checkout: `https://pay.hub.la/YftyuP6fkiKfL2daF0o1`
- Garantia: 7 dias, reembolso via `bruno@b2tech.io`
- Subdomínio padrão: `imersao-agencia` → `imersao-agencia.b2tech.io`
- Brief: `.claude/materiais-das-empresas/brunobracaioli/produtos/imersao-agencia.json`

---

## Como adicionar um produto

1. Criar `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json` seguindo o shape de
   um brief existente (use `cca.json` ou `imersao-agencia.json` como referência).
2. `slug` em `^[a-z0-9-]{2,40}$` (vira default de subdomínio + chave do produto).
3. Adicionar uma entrada aqui neste índice (nome, preço, checkout, subdomínio, path).
4. Validar: `jq . .claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`.

Nunca commitar segredo de pagamento que não seja um link público de checkout. O `checkoutUrl`
é um link público de página de pagamento (ok versionar); nada de chaves de API de gateway.
