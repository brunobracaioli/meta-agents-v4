-- Migration: add_lp_events
-- ADR: docs/adr/0021-server-side-tracking-cloudflare.md
-- Spec: docs/specs/SPEC-015-landing-page-tracking.md §7.4
-- Threat model: docs/security/threats/landing-page-tracking.md
--
-- Espelho/resumo no Supabase dos eventos que o Worker `track.b2tech.io` recebe e grava no D1
-- (banco da borda). O D1 é a fonte rápida/barata na borda; este espelho existe só para o
-- DASHBOARD nativo (web) ler via service_role — o dashboard não fala D1 direto. (ADR 0021:
-- "D1 + espelho Supabase".)
--
-- LEI LGPD/segurança: SEM PII crua. Nunca e-mail/telefone/nome aqui — só flags de matching
-- (has_email/has_phone, proxy de EMQ), atribuição (utm/country) e saúde do envio por destino.
-- A PII real é hasheada (SHA-256) no Worker e enviada à Meta; nunca persiste.

create table public.lp_events (
  id                bigint generated always as identity primary key,
  event_id          text not null,                       -- mesmo do Pixel (dedup)
  landing_page_id   uuid references public.landing_pages(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  event_name        text not null,
  event_time        timestamptz not null,

  source_url        text,
  -- atribuição (sem PII)
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  country           text,

  -- valor
  value             numeric,
  currency          text,

  -- saúde do envio por destino (HTTP status; 0 = skip)
  meta_status       integer,
  ga_status         integer,
  ads_status        integer,

  -- flags de matching (proxy de EMQ, sem expor PII)
  has_email         boolean not null default false,
  has_phone         boolean not null default false,

  created_at        timestamptz not null default now(),
  unique (event_id)
);
create index lp_events_lp_time_idx on public.lp_events (landing_page_id, event_time desc);
create index lp_events_name_idx    on public.lp_events (event_name);

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.lp_events enable row level security;
revoke all on table public.lp_events from anon, authenticated;

comment on table public.lp_events is
  'Espelho (resumo, SEM PII crua) dos eventos de tracking gravados no D1 pelo Worker track.b2tech.io. Só para o dashboard de saúde ler via service_role. RLS deny-by-default. Ver ADR 0021 / docs/security/threats/landing-page-tracking.md.';
