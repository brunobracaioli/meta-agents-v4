# SPEC-011 — Geração autônoma de landing pages + deploy no Cloudflare Pages

| Campo | Valor |
|---|---|
| Status | Draft → Implementing |
| Data | 2026-06-02 |
| Autor | brunobracaioli (via Claude Code) |
| ADR | [docs/adr/0012-landing-pages-on-cloudflare-pages.md](../adr/0012-landing-pages-on-cloudflare-pages.md) |
| Skill | `.claude/skills/create-landing-page-brunobracaioli/SKILL.md` |
| Subagents | `.claude/agents/landing-page-architect.md`, `.claude/agents/lp-copywriter.md` |
| Template | `landing-pages/_template/` |

## 1. Objetivo

Capacitar os agents/Claude Code a criar, **de ponta a ponta e sem intervenção humana**,
uma landing page profissional de alta conversão para o cliente **brunobracaioli** e
publicá-la sob `<nome>.b2tech.io` no Cloudflare Pages. O processo é **fracionado** em
etapas especializadas (estrutura de conversão → copy long-form → visual → tracking
consent-gated → build → deploy → persistência), espelhando o contrato headless de
`create-traffic-brunobracaioli-campaign`.

Disparável de duas formas:
- **Headless / CLI:** `claude -p --dangerously-skip-permissions ".claude/skills/create-landing-page-brunobracaioli nome=cca"`.
- **Ultron (Fase 2):** voz/texto → fila `agent_jobs` (`kind='landing'`) → runner Fly.

## 2. Oferta / contexto de negócio (defaults brunobracaioli)

| Campo | Valor default |
|---|---|
| Cliente | `brunobracaioli` |
| Produto | Claude Code Architect (CCA) — curso pt-BR, vibe tech/hacker |
| Preço | R$ 1.497,00 (`price_cents=149700`) |
| Checkout (Hubla) | `https://pay.hub.la/KiIZ2UcpwcbOps224hbI` |
| Landing ref (scrape) | `https://cca.b2tech.io` |
| Subdomínio default | `cca` → `cca.b2tech.io` |
| Materiais | `.claude/materiais-das-empresas/brunobracaioli/` (logo, mascote, exemplos) |
| Marca | navy `#0A0F1A`→`#0E1422`, laranja `#FF6B1A`, grid hacker |

## 3. Inputs (argumentos `key=value`)

| Arg | Default | Notas |
|---|---|---|
| `product` | `cca` | Slug do produto no catálogo (`lista-de-produtos`, ADR 0014). Lê o brief de `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`. |
| `nome` | **obrigatório** | Vira subdomínio + sufixo do projeto CF. Deve casar `^[a-z0-9-]{2,40}$`. Sem default (não assumir `cca`). |
| `ref-url` | — (opcional) | URL de referência para scrape **suplementar**. O brief do catálogo é a fonte primária; sem `ref-url` não há scrape. |
| `cart-state` | brief | Default vem do brief (`offer.cartState`); arg sobrescreve. `closed` → modo waitlist. |
| `noindex` | `1` | `1` = preview (Disallow:/); `0` = go-live indexável. |
| `deploy` | `true` | `false` = só builda local, não publica. |
| `overwrite` | `false` | `true` permite redeploy por cima de projeto CF com deploy existente. |

`checkout-url`, `cart-state` e `deadline` derivam do **brief do produto** (catálogo); um arg
explícito sobrescreve. Preço, oferta, dores, mecanismo, autoridade, números e agenda **sempre**
vêm do brief — a skill/subagents não inventam dados de produto.

## 4. Taxonomia de seções (enum fixo, implementado no template)

A LP é composta destas seções. O `landing-page-architect` só pode referenciar `type` deste
enum (nada de features de servidor):

`hero` · `urgency` · `problem` · `comparison` · `solution` · `features` · `curriculum` ·
`stats` · `proof` · `logos` · `persona` · `authority` · `offer` · `guarantee` · `faq` ·
`finalCta` · `footer`

Cada seção tem um objetivo de conversão e campos de copy próprios (ver §5). O **tom visual
é fixo por tipo** (ver ADR 0013): `hero`/`urgency`/`stats`/`authority`/`offer`/`finalCta`/
`footer` são blocos escuros; as demais ("flow") alternam striping claro/off-white
automaticamente. O architect só define ordem e objetivo — nunca cores ou tom.

**Design system** (ADR 0013): base clara + blocos escuros, accent laranja `#FF6B1A` +
funcionais (verde ✓, vermelho ✗, âmbar ★), tipografia Inter (títulos) + DM Sans (corpo) via
`@fontsource`, movimento leve (fade-in on scroll, marquee, pulse no CTA, hover-lift) que
degrada sob `prefers-reduced-motion`.

## 5. Contrato de conteúdo — `messages/pt.json`

Shape (preenchido pelo `lp-copywriter`; o template lê via `import pt from '@/messages/pt.json'`):

```jsonc
{
  "seo":   { "title": "≤60", "description": "≤155", "ogAlt": "..." },
  "hero":  { "badge": "(opcional)", "headline": "...", "subhead": "...", "ctaLabel": "..." },
  "sections": {
    "urgency":   { "label": "...", "scarcity": "(opcional)" },
    "problem":   { "heading": "...", "body": "...", "bullets": ["..."] },
    "comparison":{ "heading": "...", "subhead": "...", "ours": "...", "theirs": "...",
                   "rows": [{ "label": "...", "ours": true, "theirs": false }] },
    "solution":  { "heading": "...", "body": "..." },
    "features":  { "heading": "...", "subhead": "...", "items": [{ "icon": "(opc)", "title": "...", "desc": "..." }] },
    "curriculum":{ "heading": "...", "subhead": "...", "modules": [{ "title": "...", "desc": "..." }] },
    "stats":     { "heading": "(opc)", "items": [{ "value": "+2.000", "label": "..." }] },
    "proof":     { "heading": "...", "subhead": "...", "testimonials": [{ "quote": "...", "author": "..." }] },
    "logos":     { "heading": "(opc)", "items": ["Marca", "..."] },
    "persona":   { "heading": "...", "subhead": "...", "items": [{ "icon": "(opc)", "title": "...", "desc": "..." }] },
    "authority": { "eyebrow": "(opc)", "name": "...", "bio": "...", "credentials": ["..."], "image": "(opc, /path.jpg)" },
    "guarantee": { "heading": "...", "body": "...", "seal": "(opc, emoji)" }
  },
  "offer": { "heading": "...", "priceLabel": "R$ 1.497", "anchor": "...", "installments": "(opc)",
             "bonuses": ["..."], "guarantee": "...", "payments": ["Pix", "..."],
             "secure": "(opc)", "ctaLabel": "..." },
  "faq":   [{ "q": "...", "a": "..." }],
  "finalCta": { "headline": "...", "ctaLabel": "..." },
  "cartClosed": { "headline": "...", "subhead": "...", "waitlistCtaLabel": "Entrar na lista" },
  "footer": { "legal": "...", "links": [{ "label": "...", "href": "..." }] }
}
```

`content-spec.json` (spec de máquina, separado da copy): `{ subdomain, name, product,
price_cents, checkout_url, cart_state, noindex, deadline (ISO, opcional — countdown do
`urgency`), sections[] (ordem), tracking: { fb_pixel_id, ga4_id,
consent_key:"b2tech_consent_v1" }, seo }`.

## 6. Tracking & consent (LGPD)

- **Nada de pixel no HTML inicial.** `Consent.tsx` mostra banner; ao aceitar grava
  `localStorage["b2tech_consent_v1"] = {v:1,granted:true,ts}` e dispara evento `b2tech:consent`.
- `Tracking.tsx` (`'use client'`) só injeta FB Pixel `653995666521954` + GA4 `G-Z60CJ7W2Z8`
  (via `next/script`, `afterInteractive`) **após** consentimento concedido; então dispara `PageView`.
- `lib/utm.ts` captura UTMs da query na montagem, persiste em `sessionStorage`, e re-anexa
  ao checkout (`lib/checkout.ts`) e aos eventos de pixel.
- `lib/checkout.ts`: monta URL Hubla + UTMs; em `cart_state='closed'` troca o CTA para o
  fluxo de waitlist (WhatsApp).
- **Roteador de afiliados** (`lib/affiliate.ts` + `lib/checkout.ts`): pass-through, sem
  cadastro de afiliado no código — o token vem da URL da LP e é validado pela plataforma.
  - `?aff=<token>` (Hubla): re-anexado ao checkout Hubla como `ref=<token>`.
  - `?hmt=<código>` (Hotmart): o CTA primário **troca** para o checkout Hotmart
    (`offer.secondaryCtaHref`) com `ref=<código>` (o código do hotlink, exibido como "REF"
    no rodapé do checkout Hotmart). Tem precedência sobre `aff` quando ambos presentes;
    ignorado se a LP não tem `secondaryCtaHref` (nunca vaza pra Hubla).
  - Ambos persistem em `sessionStorage` (`b2tech_aff_v1` / `b2tech_hmt_v1`) e sobrevivem a
    navegação por âncora; UTMs continuam sendo anexadas em todos os casos.
  - **Atribuição last-click:** URL com qualquer param de afiliado é fonte de verdade pros
    DOIS canais — grava o próprio token e **limpa o token armazenado do outro canal** (um
    `?aff=` posterior re-atribui pra Hubla mesmo com `hmt` na sessão, e vice-versa). URL sem
    param de afiliado mantém a atribuição da sessão (sticky por aba; morre ao fechar a aba).
  - CTA secundário "Compra internacional" (`offer.secondaryCtaHref/Label`, opcional):
    sempre Hotmart; só anexa `ref` quando há `hmt` (token Hubla nunca vai pra Hotmart).

## 7. Etapas (resumo — detalhe no SKILL.md, Passos P0–P12)

1. Setup (stamp BRT, env, parse args, validação de `nome`/`product`, **`Read` do brief
   `${MAT}/produtos/${product}.json`** — catálogo, ADR 0014).
2. Client lookup (`clients WHERE slug='brunobracaioli'`).
3. Scrape ref (`scrape-extractor`) — **opcional**, só se `ref-url` (brief do catálogo é primário).
4. Arquitetura de conversão (`landing-page-architect`, recebe o brief do produto).
5. Copy long-form (`lp-copywriter`, escreve a partir do brief; open + cartClosed).
6. Visual hero/OG (`image-prompt-generator` + skill `image-generate`).
7. Scaffold do `_template` → `landing-pages/<nome>/`.
8. Preencher `messages/pt.json` + `content-spec.json`.
9. Build local (`npm ci`, `tsc --noEmit`, `next build` → `out/`).
10. Deploy CF Pages (project create + deploy + domain bind + verify SSL).
11. Persistir (`landing_pages` upsert + `operation_logs`).
12. Manifest (`tentativas-geracao-de-campanhas/${STAMP}-landing-page.json`).

## 8. Idempotência

- Mesmo `nome` → reusa `landing-pages/<nome>/` e o projeto CF `b2tech-<nome>`, **REDEPLOY**
  (CF Pages versiona deployments), upsert por `subdomain` em `landing_pages`.
- Scrape/copy/imagens do mesmo dia são reusados se já existirem.

## 9. Critérios de aceite

- `landing-pages/<nome>/out/{index.html,sitemap.xml,robots.txt}` gerados; `tsc --noEmit` limpo.
- Com `noindex=1`: `robots.txt` contém `Disallow: /` e `<meta name="robots" content="noindex">`.
- HTML inicial **não** contém o script do Pixel/GA4 (só injetado pós-consent no cliente).
- Com `deploy=true`: `https://<nome>.b2tech.io/` responde `200` (SSL ativo) — ou `ssl_pending`
  documentado no manifest sem falhar o run.
- Linha em `public.landing_pages` (status `deployed`, `subdomain=<nome>`) + 1 `operation_logs`
  (`entity_type='landing_page'`).
- Manifest JSON sempre escrito (sucesso `verified:true`; bloqueio `verified:false` + `errors[]`).

## 10. Anti-padrões / fora de escopo

- ❌ `AskUserQuestion` (headless) — decidir sozinho via defaults.
- ❌ Pixel/GA4 fora do gate de consentimento.
- ❌ Features de servidor (API routes, server actions, ISR) — quebram `output:'export'`.
- ❌ Commitar segredos CF ou ecoá-los em manifest/logs/telemetria.
- ❌ Flip de `noindex` sem rebuild+redeploy.
- ❌ Generalizar para outros clientes nesta skill (fixo em `brunobracaioli`).
