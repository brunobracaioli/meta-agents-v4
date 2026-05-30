-- Migration: add_agent_events
-- ADR: docs/adr/0007-daily-summaries-and-agent-events.md
-- Spec: docs/specs/web-dashboard-ultron.md
--
-- Append-only stream of granular agent activity (scrape, copy, image-gen, MCP calls)
-- emitted DURING skill execution by the emit-agent-event.py Claude Code hook on the
-- Fly.io runner. Powers the dashboard "live view". Unlike operation_logs (post-hoc,
-- per persisted entity), this captures in-progress steps for real-time mirroring.
--
-- RLS: enabled, deny-by-default. Writes via service_role (hook uses SUPABASE_SECRET_KEY).
-- The dashboard live view reads server-side via a polling endpoint (also service_role),
-- so RLS stays closed — no anon/Realtime SELECT policy is granted.

create table public.agent_events (
  id          uuid primary key default gen_random_uuid(),
  run_id      text,
  client_id   uuid references public.clients(id) on delete set null,
  ts          timestamptz not null default now(),
  agent_name  text not null,
  agent_type  text not null check (agent_type in ('skill','subagent','tool','system')),
  event_type  text not null check (event_type in ('start','step','decision','error','end')),
  tool_name   text,
  summary     text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index agent_events_ts_idx on public.agent_events (ts desc);
create index agent_events_run_id_idx on public.agent_events (run_id);
create index agent_events_client_id_idx on public.agent_events (client_id);

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.agent_events enable row level security;
