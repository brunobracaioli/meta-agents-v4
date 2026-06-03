# Reference — ContentDoc

> Representação canônica do conteúdo de uma landing page (SPEC-012 §3). Tipos em
> `packages/lp-render/src/content-doc.ts`; serializer em `…/serialize.ts`.

O **ContentDoc** é montado do Supabase (`landing_pages.settings` + `.theme` +
`landing_page_sections`) e mapeia 1:1 para os artefatos que o `next build` consome. A função
pura `contentDocToFiles(doc)` o converte em `{ messages, contentSpec, themeCss }`. Roda igual no
web (preview) e no runner Fly (publish) — por isso o preview é fiel ao publicado.

```ts
ContentDoc = {
  settings: Settings,
  theme:    Theme,
  sections: SectionDoc[]
}
```

## Settings (não-bloco — `landing_pages.settings`)

| Campo | Tipo | Editável no editor | Nota |
|---|---|---|---|
| `subdomain` | string | ❌ | identidade/deploy (`<subdomain>.b2tech.io`) |
| `name` / `product` | string | ❌ | rótulos |
| `site_url` | string | ❌ | derivado do subdomain |
| `seo` | `{title, description, ogAlt}` | ✅ | `messages.seo`; `contentSpec.seo` = {title,description} |
| `tracking` | `{fb_pixel_id, ga4_id, consent_key}` | ❌ | pixels/consent |
| `checkout_url` | string (http(s)) | ✅ | CTA de compra |
| `waitlist_url` | string (http(s)) | ✅ (opcional) | usado quando `cart_state=closed` |
| `price_cents` | int ≥ 0 | ✅ | |
| `cart_state` | `open` \| `closed` | ✅ | `closed` → CTA vira waitlist; pula curriculum/features |
| `noindex` | boolean | via publish | build-time; flip exige republicar |
| `deadline` | string ISO (opcional) | ✅ | countdown da urgency |
| `cartClosed` | `{headline, subhead, waitlistCtaLabel}` | ✅ | copy do estado de carrinho fechado |

## Theme (tokens de design — `landing_pages.theme`)

Vira um stylesheet `:root{--token: value}` (override sobre `globals.css`). **Validação:** cores
**hex**, fontes do **allowlist** (`web/lib/landing/constants.ts`), escala 0.8–1.3.

```ts
Theme = {
  fonts?: { title?: string; body?: string },   // → --font-title / --font-body
  scale?: number,                                // → html{font-size: scale*100%}
  colors?: { orange?, orangeHi?, navy900?, navy800?, text?, textDim?, bg?, bgAlt? }  // hex → --orange, …
}
```

## SectionDoc (um por bloco — linha em `landing_page_sections`)

```ts
SectionDoc = { type: SectionType, position: number, enabled: boolean, fields: object }
```

- `type` — um dos 17 SectionTypes; **único por LP** (`unique(landing_page_id, type)`).
- `position` — ordem de render (menor = topo). `contentSpec.sections` = tipos **enabled**
  ordenados por `position`.
- `enabled` — bloco visível no render/publish.
- `fields` — o copy do bloco, no **shape de `Messages`** do tipo. Validado por whitelist por
  tipo na escrita (`web/lib/landing/section-schemas.ts`).

### Onde cada `fields` aterrissa no serializer

| type | destino em `messages` | shape de `fields` |
|---|---|---|
| `hero` | `messages.hero` | `{badge?, headline, subhead, ctaLabel}` |
| `offer` | `messages.offer` | `{heading, priceLabel, anchor?, installments?, bonuses?[], guarantee?, payments?[], secure?, ctaLabel}` |
| `faq` | `messages.faq` (array) | `{items: {q, a}[]}` → o array é reconstruído |
| `finalCta` | `messages.finalCta` | `{headline, ctaLabel}` |
| `footer` | `messages.footer` | `{legal, links: {label, href}[]}` (`href` só http(s)/#/relativo) |
| `urgency`…`guarantee` (12 "middle") | `messages.sections.<type>` | ver `content-types.ts` (`Messages["sections"]`) |

As 12 seções "middle": `urgency`, `problem`, `comparison`, `solution`, `features`,
`curriculum`, `stats`, `proof`, `logos`, `persona`, `authority`, `guarantee`
(`MIDDLE_SECTION_TYPES`). `comparison.rows[].ours/theirs` é `CompareCell` = `boolean | string`.

## Concorrência

Cada `landing_page_sections.version` é incrementada a cada UPDATE. O editor e o Ultron enviam a
versão conhecida; o UPDATE casa `WHERE version=X` — 0 linhas → 409 `version_conflict`, e o
cliente reconcilia com o estado atual retornado.
