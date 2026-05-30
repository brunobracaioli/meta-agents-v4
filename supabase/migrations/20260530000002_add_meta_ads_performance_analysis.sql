-- Migration: add_meta_ads_performance_analysis
-- ADR: docs/adr/0004-meta-ads-performance-analysis-schema.md
-- Spec: docs/specs/meta-ads-performance-analysis.md
--
-- Adds the read-only performance-analysis schema consumed by the
-- analytic-traffic-brunobracaioli-campaign skill (runs every 3 days via Fly.io cron).
--   clients -> analyses -> metric_snapshots
--                      \-> analysis_findings
--
-- Append-only (created_at / captured_at, no updated_at). Same conventions as ADR 0002
-- (Meta IDs as text, money as integer cents, jsonb payloads, RLS deny-by-default).

-- analyses: one row per run (window, verdict, summary, manifest, run timestamps).
create table public.analyses (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  objective              text,
  window_start           date,
  window_stop            date,
  compare_window_start   date,
  compare_window_stop    date,
  entities_analyzed      integer not null default 0,
  active_entities        integer not null default 0,
  overall_verdict        text not null check (overall_verdict in ('healthy','watch','underperforming','learning','no_data','error')),
  summary                text,
  manifest_path          text,
  triggered_by           text not null default 'cron',
  run_started_at         timestamptz,
  run_finished_at        timestamptz,
  created_at             timestamptz not null default now()
);
create index analyses_client_id_idx on public.analyses (client_id);

-- metric_snapshots: one row per entity per run. Raw + derived metrics.
-- cplpv_cents is the traffic north-star (cost per landing page view).
-- Unique (analysis_id, level, meta_entity_id) for idempotent upsert and inter-run history.
create table public.metric_snapshots (
  id                          uuid primary key default gen_random_uuid(),
  analysis_id                 uuid not null references public.analyses(id) on delete cascade,
  client_id                   uuid not null references public.clients(id) on delete cascade,
  level                       text not null check (level in ('campaign','ad_set','ad')),
  meta_entity_id              text not null,
  entity_name                 text,
  date_start                  date,
  date_stop                   date,
  impressions                 bigint check (impressions >= 0),
  reach                       bigint check (reach >= 0),
  frequency                   numeric(12,4),
  spend_cents                 integer check (spend_cents >= 0),
  link_clicks                 integer check (link_clicks >= 0),
  ctr                         numeric(12,6),
  outbound_ctr                numeric(12,6),
  cpc_cents                   integer check (cpc_cents >= 0),
  cpm_cents                   integer check (cpm_cents >= 0),
  landing_page_views          integer check (landing_page_views >= 0),
  cplpv_cents                 integer check (cplpv_cents >= 0),
  results                     integer check (results >= 0),
  cost_per_result_cents       integer check (cost_per_result_cents >= 0),
  quality_ranking             text,
  engagement_rate_ranking     text,
  conversion_rate_ranking     text,
  raw                         jsonb,
  captured_at                 timestamptz not null default now(),
  unique (analysis_id, level, meta_entity_id)
);
create index metric_snapshots_analysis_id_idx on public.metric_snapshots (analysis_id);
create index metric_snapshots_entity_idx       on public.metric_snapshots (level, meta_entity_id);

-- analysis_findings: one row per finding/recommendation. diagnosis must cross >=2 metrics.
create table public.analysis_findings (
  id                   uuid primary key default gen_random_uuid(),
  analysis_id          uuid not null references public.analyses(id) on delete cascade,
  client_id            uuid not null references public.clients(id) on delete cascade,
  level                text check (level in ('campaign','ad_set','ad')),
  meta_entity_id       text,
  entity_name          text,
  severity             text not null check (severity in ('info','low','medium','high','critical')),
  metric_focus         text,
  diagnosis            text not null,
  evidence             jsonb,
  recommended_action   text,
  recommendation_type  text not null check (recommendation_type in ('observe','rotate_creative','pause_loser','adjust_audience','fix_landing_page','reallocate_budget','scale','none')),
  confidence           text check (confidence in ('low','medium','high')),
  is_significant       boolean not null default false,
  created_at           timestamptz not null default now()
);
create index analysis_findings_analysis_id_idx on public.analysis_findings (analysis_id);

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.analyses          enable row level security;
alter table public.metric_snapshots  enable row level security;
alter table public.analysis_findings enable row level security;
