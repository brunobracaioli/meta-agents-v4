-- Migration: add_landing_pages
-- ADR: docs/adr/0012-landing-pages-on-cloudflare-pages.md
-- Spec: docs/specs/SPEC-011-landing-page-generation.md
--
-- Persistência das landing pages geradas pela skill create-landing-page-* e publicadas
-- no Cloudflare Pages sob <subdomain>.b2tech.io. Segue as convenções da ADR 0002:
-- external IDs como text, dinheiro em *_cents, specs em jsonb, updated_at via trigger
-- set_updated_at(), RLS on deny-by-default (service_role bypassa). Chave natural =
-- subdomain (um subdomínio = uma LP), idempotente por upsert.

create table public.landing_pages (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  name                  text not null,                       -- label amigável (ex.: "CCA")
  subdomain             text not null unique,                -- "cca" → cca.b2tech.io (chave natural)
  fqdn                  text not null,                       -- "cca.b2tech.io"
  url                   text not null,                       -- "https://cca.b2tech.io"
  cloudflare_project_id text,                                -- "b2tech-cca"
  repo_path             text not null,                       -- "landing-pages/cca"
  content_spec          jsonb not null default '{}'::jsonb,  -- snapshot do content-spec.json
  tracking              jsonb not null default '{}'::jsonb,  -- {fb_pixel_id, ga4_id, consent_key}
  checkout_url          text,
  price_cents           integer check (price_cents is null or price_cents > 0),
  cart_state            text not null default 'open'  check (cart_state in ('open','closed')),
  noindex               boolean not null default true,       -- false = live/indexável
  ssl_status            text not null default 'pending' check (ssl_status in ('pending','active','error')),
  status                text not null default 'draft'  check (status in ('draft','building','deployed','failed')),
  deployed_at           timestamptz,
  last_deploy_id        text,                                -- id do deployment do wrangler
  raw_spec              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index landing_pages_client_id_idx on public.landing_pages (client_id);

create trigger set_landing_pages_updated_at
  before update on public.landing_pages
  for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.landing_pages enable row level security;

-- operation_logs precisa aceitar entity_type='landing_page' para auditar deploys de LP.
-- (a constraint inline da migration 0001 é auto-nomeada <table>_<col>_check)
alter table public.operation_logs drop constraint operation_logs_entity_type_check;
alter table public.operation_logs add constraint operation_logs_entity_type_check
  check (entity_type in ('client','campaign','ad_set','ad','creative','image','landing_page'));
