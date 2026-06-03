# ADR 0015 — Landing pages editáveis: Supabase como fonte de verdade do rascunho, Cloudflare só no publish

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-03 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-012](../specs/SPEC-012-landing-page-editor.md) |
| Relacionado | [ADR 0012](0012-landing-pages-on-cloudflare-pages.md) (hosting), [ADR 0009](0009-on-demand-agent-jobs-queue.md) (fila/runner), [ADR 0016](0016-products-table-read-model.md), [ADR 0017](0017-shared-lp-render-package.md) |
| Afeta | `landing_pages`, `landing_page_sections`, `agent_jobs`, skills de LP, `web/` |

## Context

Na SPEC-011 o conteúdo de uma LP é imutável após o deploy: para mudar uma palavra é
preciso rerodar a skill inteira (architect + copywriter + imagens + build + deploy). O
operador quer **editar ao vivo** cada bloco/campo (manualmente e por voz via Ultron) com
preview instantâneo, e publicar no Cloudflare **quando decidir**.

O Cloudflare Pages serve **estático** (ADR 0012) — não dá para editar "no ar" campo a
campo sem rebuild. Logo precisamos de uma camada de rascunho mutável **fora** do site
publicado, e de um gatilho explícito de publicação que materialize o rascunho.

Opções de fonte de verdade do rascunho:
- (a) Arquivos no repo (`messages/pt.json`) editados pela UI — exige o runner Fly para
  cada keystroke (a UI no Vercel não tem o repo), latência alta, sem multi-editor.
- (b) **Supabase** como blocos editáveis, UI/Ultron escrevem direto; publish serializa.
- (c) Um headless CMS de terceiro — dependência nova, custo, fora da stack.

## Decision

**O rascunho vive no Supabase e é a fonte de verdade; o Cloudflare recebe um snapshot só
no publish.**

- **Blocos**: `landing_page_sections` (uma linha por bloco, `fields jsonb` = copy no shape
  de `Messages`). `landing_pages.theme`/`settings` guardam tokens de design e ajustes de
  página. Juntos formam o **ContentDoc** (SPEC-012 §3).
- **Edição barata** (texto, cor, fonte): o web (Vercel) escreve **direto no Supabase**
  (síncrono) — tanto a UI quanto as tools do Ultron. Sem job, sem runner.
- **Publish** (caro): botão "Publicar"/comando de voz enfileira `agent_jobs kind=
  landing_publish`. O runner Fly serializa o ContentDoc (`contentDocToFiles`, função pura
  compartilhada) → `messages/pt.json` + `content-spec.json` + `theme.css` → `next build`
  → `wrangler deploy` (reusa o P9 da SPEC-011) → grava `published_snapshot`.
- **Dois estados, dois campos**: `draft_status` (rascunho no Supabase) é ortogonal a
  `status`/`ssl_status` (deploy no Cloudflare, SPEC-011). `noindex` segue build-time.
- **Edições caras** que precisam da VM (ex.: regenerar imagem com `image-generate`) usam
  `kind=landing_edit` (job), não o caminho síncrono.

## Consequences

- ✅ Edição instantânea e multi-editor (operador + Ultron) sem tocar o site publicado.
- ✅ Pipeline de build/deploy da SPEC-011 **intacto** — só ganha um serializer na frente.
- ✅ `published_snapshot` dá diff/rollback e auditoria do que está no ar.
- ✅ Custo de build do Cloudflare controlado (publish explícito, não por keystroke).
- ⚠️ Divergência rascunho × publicado é possível e **intencional**; a UI deve sinalizar
  "alterações não publicadas".
- ⚠️ Concorrência de escrita resolvida por `version` otimista por seção (last-write-wins
  consciente + broadcast), não por lock pessimista.
- ⚠️ O ContentDoc precisa permanecer 1:1 com `Messages`/`ContentSpec`; mudanças de shape
  exigem atualizar o serializer e seu teste (round-trip) no mesmo PR.
