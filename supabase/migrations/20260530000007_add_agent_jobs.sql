-- Migration: add_agent_jobs
-- ADR: docs/adr/0009-on-demand-agent-jobs-queue.md
-- Spec: docs/specs/ultron-agent-trigger.md
--
-- Durable job queue so the Ultron voice assistant (Vercel, serverless ~60s) can
-- trigger long-running skills (5-25 min) on the Fly.io runner, which is a pure
-- worker with NO HTTP surface (ADR 0001 rejected an inbound webhook). The web app
-- INSERTs a job; the runner polls + claims it atomically, runs run-skill.sh, and
-- writes the terminal status back. The `skill` is resolved server-side from a fixed
-- allowlist in the web tools — never free-form user text.
--
-- RLS: enabled, deny-by-default. Both writers (Vercel + Fly poller) use service_role
-- (SUPABASE_SECRET_KEY), which bypasses RLS. No anon/authenticated policy granted.

create table public.agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  skill        text not null,
  kind         text not null check (kind in ('create','activate','analyze','summarize')),
  args         jsonb not null default '{}'::jsonb,
  status       text not null default 'pending'
                 check (status in ('pending','claimed','running','completed','failed','cancelled')),
  requested_by text not null default 'ultron',
  confirmed_at timestamptz not null default now(),
  claimed_by   text,
  claimed_at   timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  exit_code    integer,
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index agent_jobs_status_idx on public.agent_jobs (status, created_at);
create index agent_jobs_client_id_idx on public.agent_jobs (client_id);

-- At most one in-flight job per (client, kind): guards against a misheard voice
-- command (or a double-tap) enqueueing the same work twice. The INSERT fails with a
-- unique violation, which the web tool surfaces as "já existe um pedido em andamento".
create unique index agent_jobs_one_active_per_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running');

-- RLS: enabled, deny-by-default (no policies). service_role bypasses RLS.
alter table public.agent_jobs enable row level security;

-- Atomic claim for the Fly poller: take the oldest pending job and mark it claimed
-- in one statement. FOR UPDATE SKIP LOCKED makes concurrent pollers safe. SECURITY
-- DEFINER + pinned empty search_path follows the hardening of set_updated_at().
create or replace function public.claim_agent_job(p_worker_id text)
returns setof public.agent_jobs
language sql
security definer
set search_path = ''
as $$
  update public.agent_jobs
     set status = 'claimed',
         claimed_by = p_worker_id,
         claimed_at = now()
   where id = (
     select id
       from public.agent_jobs
      where status = 'pending'
      order by created_at asc
      limit 1
      for update skip locked
   )
  returning *;
$$;

-- Least privilege: only service_role may claim jobs (matches migration 0004 pattern).
revoke execute on function public.claim_agent_job(text) from public, anon, authenticated;
