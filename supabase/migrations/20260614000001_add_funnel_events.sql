-- Migration: add_funnel_events
-- ADR: docs/adr/0025-meta-ads-funnel-analytics-b2tech.md
-- Spec: docs/specs/meta-ads-funnel-analytics.md
--
-- Normalized conversion funnel captured per analysis run by the
-- funnel-analytics-brunobracaioli-campaign skill (daily, read-only). It uses the
-- mcp-meta-ads-b2tech connector, which exposes the FULL conversion funnel
-- (impression -> link_click -> landing_page_view -> view_content -> add_to_cart
--  -> initiate_checkout -> purchase, with action_values + purchase_roas) that the
-- official Meta MCP does not surface in a consolidated way.
--
-- One row per (analysis, entity, funnel step). This is the read model that powers
-- the visual event funnel in the web dashboard. Same conventions as ADR 0002/0004:
-- Meta IDs as text, money as integer cents, jsonb payloads, append-only, RLS
-- deny-by-default (service_role bypasses; the dashboard reads server-side).

create table public.funnel_events (
  id                    uuid primary key default gen_random_uuid(),
  analysis_id           uuid not null references public.analyses(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  level                 text not null check (level in ('account','campaign','ad_set','ad')),
  meta_entity_id        text not null,
  entity_name           text,
  objective             text,
  date_start            date,
  date_stop             date,
  -- Canonical funnel order: impression=1, link_click=2, landing_page_view=3,
  -- view_content=4, add_to_cart=5, initiate_checkout=6, purchase=7.
  step_order            smallint not null check (step_order >= 1),
  event_type            text not null check (event_type in (
                          'impression','link_click','landing_page_view',
                          'view_content','add_to_cart','initiate_checkout','purchase')),
  count                 bigint  not null default 0 check (count >= 0),
  value_cents           integer check (value_cents >= 0),          -- monetary value (purchase revenue); null when N/A
  cost_per_event_cents  integer check (cost_per_event_cents >= 0), -- spend / count (or cost_per_action_type)
  cvr_from_prev         numeric(12,6),                              -- count / previous step count
  cvr_from_top          numeric(12,6),                              -- count / impression (top of funnel)
  raw                   jsonb,                                      -- source action_type(s) + values used
  captured_at           timestamptz not null default now(),
  unique (analysis_id, level, meta_entity_id, event_type)
);
create index funnel_events_analysis_id_idx on public.funnel_events (analysis_id);
create index funnel_events_entity_idx       on public.funnel_events (level, meta_entity_id);
create index funnel_events_client_event_idx on public.funnel_events (client_id, event_type);

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.funnel_events enable row level security;
