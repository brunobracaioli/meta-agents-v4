# ADR 0018 — Imagens de landing page como URL pública em `fields` (sem tabela de assets)

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-04 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-012](../specs/SPEC-012-landing-page-editor.md) |
| Relacionado | [ADR 0003](0003-public-ad-ingest-bucket.md) (bucket público p/ fetch externo), [ADR 0015](0015-editable-landing-pages-supabase-draft.md) (rascunho no Supabase), [ADR 0017](0017-shared-lp-render-package.md) |
| Afeta | `packages/lp-render/`, `landing-pages/_template/`, `web/`, skills `create-landing-page-*` / `publish-landing-page-*` |

## Context

Até aqui as landing pages nasciam **visualmente text-only**. O `image-prompt-generator` +
`image-generate` produziam `hero.png`/`og.png` (custo gpt-image-2), gravados em
`${LP_DIR}/public/`, mas:

1. **Render**: nenhuma seção renderizava imagem, exceto `Authority` (foto opcional). O fundo do
   hero é um grid em CSS — o `hero.png` gerado **nunca** era exibido. Só o `og.png` (preview
   social, fora da página) usava imagem.
2. **Persistência**: as imagens só viviam no disco efêmero da máquina Fly. Não iam ao Supabase
   Storage. Um republish em máquina/dir limpo saía sem imagem (round-trip "Wave 4 — não feito").
3. **Edição**: o endpoint `POST /api/landing-pages/:id/assets` (bucket `landing-assets`) já
   existia, mas sem UI no editor nem tool do Ultron para usar.

Queremos seções com **imagem editável, persistente e renderizada**, sem inflar o modelo de
dados nem criar uma superfície de manutenção nova (tabela de assets, GC, audit por imagem).

## Decision

**A imagem de uma seção é uma `string` (URL absoluta) guardada no próprio
`landing_page_sections.fields` (campo `image`), e o `og` vai em `settings.seo.ogImage`.** Sem
tabela `landing_page_image_refs`. As URLs apontam para o bucket **público** `landing-assets`
(mesmo padrão do `ad-ingest` da ADR 0003); como o bucket é público, o `<img src>` do export
estático carrega a imagem direto do Storage no browser — o build **não** depende de arquivo
local.

Consequências do desenho:

- **Render** (`packages/lp-render`): `image?: string` em `hero/problem/solution/features/proof`
  (+ `authority.image` que já existia) e `seo.ogImage?`. Os componentes renderizam um `<img>`
  condicional (padrão `Authority.tsx`), `images.unoptimized` (static export, `<img>` puro).
- **Geração** (`create-landing-page-*` Passo 6): após gerar localmente, faz upload best-effort
  ao `landing-assets` e grava as URLs em `fields.image`/`settings.seo.ogImage`/`settings.logo`
  (merge — não clobber a copy). Falha de upload não aborta (degrada para texto). Os caminhos de
  origem dos assets são resolvidos de `assets.*` do brief (com fallback de convenção), tornando
  o brief a fonte de verdade — antes os caminhos eram hardcoded na skill e o bloco `assets` era
  decorativo.
- **Logo da marca** (page-level, "completa"): `settings.logo` (DB) → `contentSpec.logo`
  (serializer) → renderizada no **topo do hero** (o hero é dark, casa com logos claras). Editável
  no painel **Config** do editor (não é seção, então fora do tool de imagem por seção do Ultron;
  mesma lógica do `seo.ogImage`). Antes, nenhuma logo da marca aparecia na página.
- **Publish** (`publish-landing-page-*` Passo 5): URLs absolutas renderizam direto; o download
  para `public/` vira back-compat best-effort (conteúdo legado com caminho relativo).
- **Editor** (`web/field-editor`): `ImageField` com preview + upload (reusa `POST /:id/assets`)
  + colar URL; slot sempre visível para seções com imagem (permite adicionar onde não há).
- **Ultron**: tool `request_landing_page_section_image` seta/troca/remove a URL (mesmo fluxo de
  confirmação + concorrência otimista do `request_landing_page_edit`; dispara o realtime sync).
- **Validação**: `image: txt.optional()` nos schemas Zod `.strict()` (write boundary); a tool do
  Ultron exige https + raster/landing-assets (bloqueia `javascript:`/`data:`).

## Consequences

**Positivas**
- Mínimo de código e zero migration — `fields` jsonb absorve o campo.
- Durabilidade: imagens sobrevivem a republish/edição (vivem no Storage, não no disco Fly).
- Uma só superfície de edição (copy e imagem são "mais um campo string"); realtime sync,
  reconciliação e validação reusados sem mudança.

**Negativas / trade-offs aceitos**
- **Sem audit trail por imagem** (custo/prompt/origem) como o par `generated_images`+`creatives`
  dos ads. Aceitável no MVP; revisitar se precisar de relatório de custo de imagem de LP.
- **Sem GC de órfãos**: trocar/remover imagem deixa o objeto antigo no bucket. Aceitável
  (bucket barato); um job de limpeza pode entrar depois.
- **Página depende do bucket público** em runtime (request externo + a URL expõe o project ref
  do Supabase). Mitigado por ser público por design (mesmo modelo do `ad-ingest`) e CDN-fronted.
- **Sem dedup**: regeração reupa com `x-upsert` em caminho estável `${LP_ID}/<file>`, então hero/
  og são idempotentes; imagens do editor usam caminho com timestamp (acumulam).

## Alternatives considered

- **Tabela `landing_page_image_refs`** (espelho do padrão de ads): mais robusto (audit + GC),
  mas adiciona migration, modelo e código de sincronização para um ganho que o MVP não precisa.
- **Baixar tudo para `public/` e referenciar caminho relativo** (página self-contained no
  Cloudflare): evita dependência do Storage em runtime, mas exige o publish mutar referências
  do rascunho (caminho → basename), o que quebra a pureza do serializer. Rejeitado por
  complexidade; URLs absolutas são "duráveis o suficiente".
