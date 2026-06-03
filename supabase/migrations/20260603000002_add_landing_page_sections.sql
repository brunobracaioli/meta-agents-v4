-- Migration: add_landing_page_sections
-- ADR: docs/adr/0015-editable-landing-pages-supabase-draft.md
-- Spec: docs/specs/SPEC-012-landing-page-editor.md
--
-- Cada bloco editável de uma landing page é uma linha aqui — esta tabela é a FONTE DE
-- VERDADE DO RASCUNHO. O operador (UI) e o Ultron (voz) editam `fields` (o copy do
-- bloco, no shape de Messages do template). O publish (Cloudflare) é um snapshot
-- buildado a partir destas linhas; até lá, edições são instantâneas e não tocam o site
-- publicado. `type` é o SectionType do template (hero, problem, offer, ...); v1 admite
-- no máximo um bloco de cada tipo por LP (unique). `position` controla a ordem de render.
-- `version` é concorrência otimista (UI e Ultron podem editar a mesma LP).

create table public.landing_page_sections (
  id               uuid primary key default gen_random_uuid(),
  landing_page_id  uuid not null references public.landing_pages(id) on delete cascade,
  type             text not null,                       -- SectionType: hero|urgency|problem|...|footer
  position         integer not null,                    -- ordem de render (menor = topo)
  enabled          boolean not null default true,       -- bloco visível no render/publish
  fields           jsonb not null default '{}'::jsonb,  -- copy do bloco (shape de Messages)
  version          integer not null default 1,          -- concorrência otimista
  updated_by       text,                                -- 'operator' | 'ultron' | 'generator'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (landing_page_id, type)
);
create index landing_page_sections_lp_position_idx
  on public.landing_page_sections (landing_page_id, position);

create trigger set_landing_page_sections_updated_at
  before update on public.landing_page_sections
  for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.landing_page_sections enable row level security;
