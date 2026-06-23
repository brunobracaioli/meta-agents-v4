-- Migration: agent_jobs_add_operator_id_scoped_claim
-- ADR: docs/adr/0026-multi-operator-tenancy.md, docs/adr/0027-runner-per-operator.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
--
-- Each operator runs a dedicated Fly runner (ADR 0027) that must claim ONLY its own jobs.
-- Add agent_jobs.operator_id (denormalized; set on enqueue) and a scoped claim RPC that
-- filters by operator. NULLABLE for now: legacy rows predate the column, and NOT NULL is
-- deferred to the Phase 7 cutover. The 1-arg claim_agent_job(text) is kept for backward
-- compatibility during the transition and dropped in Phase 4 once every runner passes
-- OPERATOR_ID.
--
-- RLS: unchanged (deny-by-default); both the enqueue path and the runner use service_role.

alter table public.agent_jobs
  add column operator_id uuid references public.operators(id) on delete cascade;

create index agent_jobs_operator_status_idx
  on public.agent_jobs (operator_id, status, created_at);

-- Scoped atomic claim: oldest pending job FOR THIS OPERATOR, marked claimed in one
-- statement. FOR UPDATE SKIP LOCKED keeps concurrent runners safe. SECURITY DEFINER +
-- pinned empty search_path, EXECUTE revoked from public/anon/authenticated (ADR 0008 pattern).
create or replace function public.claim_agent_job(p_worker_id text, p_operator_id uuid)
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
        and operator_id = p_operator_id
      order by created_at asc
      limit 1
      for update skip locked
   )
  returning *;
$$;

revoke execute on function public.claim_agent_job(text, uuid) from public, anon, authenticated;
