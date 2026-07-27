-- Migration: add_flows
-- ADR: docs/adr/0034-flow-builder-dag-over-agent-jobs.md
-- Spec: docs/specs/SPEC-020-flow-builder.md (§3.1, §3.4 — Wave 1)
--
-- Flow Builder foundation: flow DEFINITIONS only. Execution tables (flow_runs,
-- flow_step_runs), the engine RPCs and the agent_jobs 'flow_step' kind land in Wave 2.
-- RLS follows ADR 0026: SELECT for authenticated scoped by operator (grant + policy —
-- Postgres checks the table grant BEFORE row policies, see 20260627000001); zero write
-- policies — every write goes through service_role (Hono API).

create table public.flows (
  id          uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text,
  status      text not null default 'draft' check (status in ('draft','active','archived')),
  -- Serializable subset of the React Flow state ({nodes, edges}); interpreted server-side
  -- only at Run time (Wave 2 freezes it into flow_runs.graph_snapshot).
  graph       jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- List screen: an operator's flows ordered by recency.
create index flows_operator_idx on public.flows (operator_id, updated_at desc);
create index flows_client_idx on public.flows (client_id);

create trigger set_flows_updated_at before update on public.flows
  for each row execute function public.set_updated_at();

alter table public.flows enable row level security;

create policy flows_select_own on public.flows
  for select to authenticated
  using (operator_id = (select auth.uid()));

grant select on table public.flows to authenticated;

-- Image/logo references attached to the image_creative card. Files live in the PUBLIC
-- bucket `flow-assets` (runner downloads by URL, panel previews without signed URLs;
-- brand refs are not secret) — bucket is created idempotently by the upload endpoint,
-- landing-assets pattern.
create table public.flow_assets (
  id          uuid primary key default gen_random_uuid(),
  flow_id     uuid not null references public.flows(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  path        text not null,
  mime        text not null check (mime in ('image/png','image/jpeg','image/webp')),
  size_bytes  integer not null check (size_bytes > 0 and size_bytes <= 5000000),
  created_at  timestamptz not null default now()
);

create index flow_assets_flow_idx on public.flow_assets (flow_id, created_at desc);

alter table public.flow_assets enable row level security;

create policy flow_assets_select_own on public.flow_assets
  for select to authenticated
  using (operator_id = (select auth.uid()));

grant select on table public.flow_assets to authenticated;
