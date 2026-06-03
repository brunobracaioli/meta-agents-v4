-- Migration: add_products
-- ADR: docs/adr/0016-products-table-read-model.md
-- Spec: docs/specs/SPEC-012-landing-page-editor.md
--
-- Tabela `products` como read-model da hierarquia cliente → produto → landing page.
-- O catálogo canônico de geração continua em arquivo (.claude/materiais-das-empresas/
-- <cliente>/produtos/<slug>.json, ADR 0014) — esta tabela é a projeção que o dashboard
-- usa para listar produtos e rotear /dashboard/clients/<slug>/<produto>/.... O `brief`
-- é um snapshot jsonb do arquivo (sincronizado na geração), e `brief_path` aponta para
-- a fonte de verdade em disco. Segue convenções da ADR 0002 (text ids, jsonb, trigger
-- set_updated_at, RLS deny-by-default).

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  slug               text not null,                       -- "cca", "imersao-agencia"
  name               text not null,                       -- "Claude Code Architect"
  brief_path         text,                                -- caminho do brief em disco (fonte de geração)
  brief              jsonb not null default '{}'::jsonb,  -- snapshot do brief para o read-model do dashboard
  default_subdomain  text,                                -- subdomínio padrão sugerido
  status             text not null default 'active' check (status in ('active','archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, slug)
);
create index products_client_id_idx on public.products (client_id);

create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.products enable row level security;
