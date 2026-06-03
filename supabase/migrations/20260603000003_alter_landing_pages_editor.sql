-- Migration: alter_landing_pages_editor
-- ADR: docs/adr/0015-editable-landing-pages-supabase-draft.md
-- Spec: docs/specs/SPEC-012-landing-page-editor.md
--
-- Estende landing_pages para o editor ao vivo:
--   product_id          → liga a LP ao produto (hierarquia cliente → produto → LP)
--   theme               → tokens de design por LP (fontes, escala, cores) sobre os defaults
--   settings            → ajustes de página não-bloco (seo, cartClosed, deadline, waitlist...)
--   draft_status        → estado do RASCUNHO no Supabase (independente de `status`, que é o
--                         estado do DEPLOY no Cloudflare). generating = agents preenchendo
--                         seções ao vivo; ready = pronto pra editar; publishing = job de
--                         publish em andamento.
--   published_at        → quando o último snapshot foi publicado no Cloudflare
--   published_snapshot  → ContentDoc exato do último publish (diff / rollback / auditoria)

alter table public.landing_pages
  add column product_id          uuid references public.products(id) on delete set null,
  add column theme               jsonb not null default '{}'::jsonb,
  add column settings            jsonb not null default '{}'::jsonb,
  add column draft_status        text not null default 'empty'
    check (draft_status in ('empty','generating','ready','editing','publishing')),
  add column published_at        timestamptz,
  add column published_snapshot  jsonb;

create index landing_pages_product_id_idx on public.landing_pages (product_id);
