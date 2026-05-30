-- Migration: init_meta_ads_agency_schema
-- ADR: docs/adr/0002-supabase-meta-ads-persistence-schema.md
-- Spec: docs/specs/meta-ads-persistence-schema.md
--
-- Recreates the base persistence schema for the autonomous Meta Ads agency
-- (clients -> campaigns -> ad_sets -> ads >- creatives >- generated_images,
--  plus operation_logs audit trail).
--
-- Conventions (ADR 0002):
--   * Meta external IDs as text (opaque identifiers, future-proof upserts).
--   * Money as integer cents (Marketing API works in cents).
--   * raw_spec / targeting as jsonb (raw MCP payload for audit/replay).
--   * updated_at via set_updated_at() trigger, search_path pinned to '' (advisor 0011 hardening).
--   * RLS enabled, deny-by-default (no policies); the agent writes via service_role (bypasses RLS).

-- updated_at trigger function (search_path pinned — folds in harden_set_updated_at_search_path).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- clients: managed infoprodutor / ad account. Natural keys: slug, ad_account_id.
create table public.clients (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  ad_account_id           text not null unique,
  business_manager_id     text,
  facebook_page_id        text,
  default_landing_url     text,
  daily_budget_cap_cents  integer not null default 5000 check (daily_budget_cap_cents > 0),
  currency                text not null default 'BRL',
  materials_path          text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- campaigns: Meta campaign. Natural key: meta_campaign_id. budget_mode in {CBO, ABO}.
create table public.campaigns (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  meta_campaign_id       text not null unique,
  name                   text not null,
  objective              text not null,
  buying_type            text not null default 'AUCTION',
  budget_mode            text not null check (budget_mode in ('CBO','ABO')),
  daily_budget_cents     integer check (daily_budget_cents > 0),
  bid_strategy           text,
  status                 text not null default 'PAUSED',
  special_ad_categories  text[] not null default '{}',
  ads_manager_url        text,
  raw_spec               jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index campaigns_client_id_idx on public.campaigns (client_id);

-- ad_sets: Meta ad set. Natural key: meta_ad_set_id.
-- In CBO budget lives on campaigns.daily_budget_cents and ad_sets.daily_budget_cents is NULL.
create table public.ad_sets (
  id                     uuid primary key default gen_random_uuid(),
  campaign_id            uuid not null references public.campaigns(id) on delete cascade,
  meta_ad_set_id         text not null unique,
  name                   text not null,
  optimization_goal      text,
  billing_event          text not null default 'IMPRESSIONS',
  destination_type       text,
  daily_budget_cents     integer check (daily_budget_cents > 0),
  targeting              jsonb,
  advantage_audience     boolean not null default false,
  advantage_placements   boolean not null default false,
  status                 text not null default 'PAUSED',
  raw_spec               jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index ad_sets_campaign_id_idx on public.ad_sets (campaign_id);

-- generated_images: gpt-image-2 asset in Storage. Natural key: (storage_bucket, storage_path).
create table public.generated_images (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  variant_key         text,
  storage_bucket      text not null,
  storage_path        text not null,
  width               integer,
  height              integer,
  mime_type           text,
  model               text,
  prompt              text,
  aspect              text,
  cost_usd_estimate   numeric(10,4),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index generated_images_client_id_idx on public.generated_images (client_id);

-- creatives: copy + CTA + link + image. Natural key: meta_creative_id.
create table public.creatives (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  generated_image_id    uuid references public.generated_images(id) on delete set null,
  meta_creative_id      text not null unique,
  name                  text,
  page_id               text,
  link_url              text,
  headline              text,
  primary_text          text,
  description           text,
  call_to_action_type   text,
  image_url             text,
  raw_spec              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index creatives_client_id_idx on public.creatives (client_id);

-- ads: Meta ad. Natural key: meta_ad_id.
create table public.ads (
  id                uuid primary key default gen_random_uuid(),
  ad_set_id         uuid not null references public.ad_sets(id) on delete cascade,
  creative_id       uuid references public.creatives(id) on delete set null,
  meta_ad_id        text not null unique,
  name              text not null,
  status            text not null default 'PAUSED',
  effective_status  text,
  ads_manager_url   text,
  raw_spec          jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index ads_ad_set_id_idx on public.ads (ad_set_id);

-- operation_logs: create/update/delete/activate/pause audit trail. Append-only (created_at only).
create table public.operation_logs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients(id) on delete set null,
  entity_type     text not null check (entity_type in ('client','campaign','ad_set','ad','creative','image')),
  entity_id       uuid,
  meta_entity_id  text,
  action          text not null check (action in ('create','update','delete','activate','pause')),
  actor           text not null default 'claude-code',
  summary         text,
  created_at      timestamptz not null default now()
);
create index operation_logs_client_id_idx on public.operation_logs (client_id);

-- updated_at triggers (base tables only; operation_logs is append-only).
create trigger set_clients_updated_at          before update on public.clients          for each row execute function public.set_updated_at();
create trigger set_campaigns_updated_at        before update on public.campaigns        for each row execute function public.set_updated_at();
create trigger set_ad_sets_updated_at          before update on public.ad_sets          for each row execute function public.set_updated_at();
create trigger set_generated_images_updated_at before update on public.generated_images for each row execute function public.set_updated_at();
create trigger set_creatives_updated_at        before update on public.creatives        for each row execute function public.set_updated_at();
create trigger set_ads_updated_at              before update on public.ads              for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.clients          enable row level security;
alter table public.campaigns        enable row level security;
alter table public.ad_sets          enable row level security;
alter table public.generated_images enable row level security;
alter table public.creatives        enable row level security;
alter table public.ads              enable row level security;
alter table public.operation_logs   enable row level security;
