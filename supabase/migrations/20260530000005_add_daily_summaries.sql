-- Migration: add_daily_summaries
-- ADR: docs/adr/0007-daily-summaries-and-agent-events.md
-- Spec: docs/specs/web-dashboard-ultron.md
--
-- One AI-generated daily summary per client, so the Ultron assistant can answer
-- "o que foi feito hoje / para o cliente X" with a single read instead of scanning
-- operation_logs/analyses each time. Upserted by the daily-summary headless skill
-- (cron on Fly.io). Idempotent per (client_id, summary_date).
--
-- Conventions (ADR 0002): updated_at via set_updated_at() trigger; RLS enabled,
-- deny-by-default (service_role bypasses; the dashboard reads server-side via secret key).

create table public.daily_summaries (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  summary_date  date not null,
  summary       text not null,
  structured    jsonb,
  model         text,
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, summary_date)
);
create index daily_summaries_date_idx on public.daily_summaries (summary_date desc);
create index daily_summaries_client_id_idx on public.daily_summaries (client_id);

create trigger set_daily_summaries_updated_at
  before update on public.daily_summaries
  for each row execute function public.set_updated_at();

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.daily_summaries enable row level security;
