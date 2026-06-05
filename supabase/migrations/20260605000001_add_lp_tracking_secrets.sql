-- Migration: add_lp_tracking_secrets
-- ADR: docs/adr/0021-server-side-tracking-cloudflare.md
-- Spec: docs/specs/SPEC-015-landing-page-tracking.md §7.4
-- Threat model: docs/security/threats/landing-page-tracking.md
--
-- Depósito ISOLADO dos SEGREDOS de conversão server-side (Fase 2). Diferente de
-- `landing_pages.settings.tracking` (que carrega só IDs PÚBLICOS e é serializado para o
-- content-spec.json público), esta tabela guarda os tokens que NUNCA podem aparecer no
-- browser: Meta CAPI access token, GA4 API secret, bundle do Google Ads.
--
-- Postura de segurança (igual às tabelas do editor, migration 0005): RLS deny-by-default
-- (sem policies) + grants revogados de anon/authenticated. Só o service_role acessa:
--   • o Worker `track.b2tech.io` LÊ (resolve o tenant por landing_page_id) com a service key;
--   • a API write-only do editor ESCREVE (PUT /api/landing-pages/:id/tracking-secrets).
-- O serializer (packages/lp-render) NUNCA seleciona esta tabela — é a lei público×segredo.

create table public.lp_tracking_secrets (
  id                uuid primary key default gen_random_uuid(),
  landing_page_id   uuid not null references public.landing_pages(id) on delete cascade,
  provider          text not null check (provider in ('meta','ga4','google_ads')),
  public_id         text not null,                       -- pixel_id | G-XXXX | AW-customer_id
  secret            jsonb not null default '{}'::jsonb,  -- {capi_token} | {api_secret} | {developer_token,conversion_action,refresh_token,client_id,client_secret,login_customer_id}
  test_event_code   text,                                -- só Meta, só homologação (Test Events)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (landing_page_id, provider, public_id)
);
create index lp_tracking_secrets_lp_idx on public.lp_tracking_secrets (landing_page_id);

create trigger set_lp_tracking_secrets_updated_at
  before update on public.lp_tracking_secrets
  for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.lp_tracking_secrets enable row level security;

-- Defesa em profundidade: remove a tabela da superfície do PostgREST para anon/authenticated
-- (least privilege). Mesma estratégia da migration 0005. Revogar grant inexistente é no-op.
revoke all on table public.lp_tracking_secrets from anon, authenticated;

comment on table public.lp_tracking_secrets is
  'SEGREDOS de conversão server-side por landing page (Meta CAPI token, GA4 API secret, Google Ads). RLS deny-by-default; acesso só via service_role (Worker lê, editor escreve write-only). NUNCA serializado para o content-spec público. Ver ADR 0021 / docs/security/threats/landing-page-tracking.md.';
comment on column public.lp_tracking_secrets.secret is
  'Bundle de segredo do provider (jsonb). NUNCA devolvido por API ao cliente; lido só pelo Worker server-side.';
