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
| `nome` | `cca` | Vira subdomínio + sufixo do projeto CF. Deve casar `^[a-z0-9-]{2,40}$`. |
| `ref-url` | `https://cca.b2tech.io` | URL de referência para scrape. |
| `checkout-url` | Hubla CCA | URL de checkout. |
| `cart-state` | `open` | `open` \| `closed` (closed → modo waitlist WhatsApp). |
| `noindex` | `1` | `1` = preview (Disallow:/); `0` = go-live indexável. |
| `deploy` | `true` | `false` = só builda local, não publica. |

Sem argumentos → usa os defaults acima.

## 4. Taxonomia de seções (enum fixo, implementado no template)

A LP é composta destas seções, nesta ordem default. O `landing-page-architect` só pode
referenciar `type` deste enum (nada de features de servidor):

`hero` · `problem` · `solution` · `features` · `curriculum` · `proof` · `offer` · `faq` ·
`finalCta` · `footer`

Cada seção tem um objetivo de conversão e campos de copy próprios (ver §5).

## 5. Contrato de conteúdo — `messages/pt.json`

Shape (preenchido pelo `lp-copywriter`; o template lê via `import pt from '@/messages/pt.json'`):

```jsonc
{
  "seo":   { "title": "≤60", "description": "≤155", "ogAlt": "..." },
  "hero":  { "headline": "...", "subhead": "...", "ctaLabel": "..." },
  "sections": {
    "problem":   { "heading": "...", "body": "...", "bullets": ["..."] },
    "solution":  { "heading": "...", "body": "..." },
    "features":  { "heading": "...", "items": [{ "title": "...", "desc": "..." }] },
    "curriculum":{ "heading": "...", "modules": [{ "title": "...", "desc": "..." }] },
    "proof":     { "heading": "...", "testimonials": [{ "quote": "...", "author": "..." }] }
  },
  "offer": { "heading": "...", "priceLabel": "R$ 1.497", "anchor": "...",
             "bonuses": ["..."], "guarantee": "...", "ctaLabel": "..." },
  "faq":   [{ "q": "...", "a": "..." }],
  "finalCta": { "headline": "...", "ctaLabel": "..." },
  "cartClosed": { "headline": "...", "subhead": "...", "waitlistCtaLabel": "Entrar na lista" },
  "footer": { "legal": "...", "links": [{ "label": "...", "href": "..." }] }
}
```

`content-spec.json` (spec de máquina, separado da copy): `{ subdomain, name, product,
price_cents, checkout_url, cart_state, noindex, sections[] (ordem), tracking: { fb_pixel_id,
ga4_id, consent_key:"b2tech_consent_v1" }, seo }`.

## 6. Tracking & consent (LGPD)

- **Nada de pixel no HTML inicial.** `Consent.tsx` mostra banner; ao aceitar grava
  `localStorage["b2tech_consent_v1"] = {v:1,granted:true,ts}` e dispara evento `b2tech:consent`.
- `Tracking.tsx` (`'use client'`) só injeta FB Pixel `653995666521954` + GA4 `G-Z60CJ7W2Z8`
  (via `next/script`, `afterInteractive`) **após** consentimento concedido; então dispara `PageView`.
- `lib/utm.ts` captura UTMs da query na montagem, persiste em `sessionStorage`, e re-anexa
  ao checkout (`lib/checkout.ts`) e aos eventos de pixel.
- `lib/checkout.ts`: monta URL Hubla + UTMs; em `cart_state='closed'` troca o CTA para o
  fluxo de waitlist (WhatsApp).

## 7. Etapas (resumo — detalhe no SKILL.md, Passos P0–P12)

1. Setup (stamp BRT, env, parse args, validação de `nome`).
2. Client lookup (`clients WHERE slug='brunobracaioli'`).
3. Scrape ref (`scrape-extractor`).
4. Arquitetura de conversão (`landing-page-architect`).
5. Copy long-form (`lp-copywriter`, open + cartClosed).
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
