-- Migration: scoped_claim_autonomous_watch
-- ADR: docs/adr/0027-runner-per-operator.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
--
-- Phase 4 (runner per operator). A per-operator Fly runner (OPERATOR_ID set) must tick ONLY its
-- own operator's autonomous watches. Add a 2-arg overload of claim_autonomous_watch scoped via
-- the watch's client -> operator. Mirrors the 1-arg DUE logic (phase active, updated_at older
-- than the ~90s narration cadence, FOR UPDATE SKIP LOCKED) from migration 20260604000001. The
-- 1-arg version is KEPT for the legacy single-tenant runner (no OPERATOR_ID).
--
-- NOTE: NOT YET APPLIED to production in Phase 4. This overload is only invoked by a runner with
-- OPERATOR_ID, which does not exist until post-launch provisioning. It is purely additive (a new
-- function signature) and safe; apply it together with the per-operator runner validation / the
-- Phase 7 cutover. The live single-tenant runner keeps using claim_autonomous_watch(text).
--
-- RLS: unchanged (deny-by-default); the runner uses service_role.

create or replace function public.claim_autonomous_watch(p_worker_id text, p_operator_id uuid)
returns setof public.autonomous_watches
language sql
security definer
set search_path = ''
as $$
  update public.autonomous_watches
     set updated_at = now()
   where id = (
     select w.id
       from public.autonomous_watches w
       join public.clients c on c.id = w.client_id
      where w.phase in ('watching','reviewing','notifying')
        and w.updated_at < now() - interval '90 seconds'
        and c.operator_id = p_operator_id
      order by w.updated_at asc
      limit 1
      for update of w skip locked
   )
  returning *;
$$;

-- Least privilege: only service_role may claim (ADR 0008 pattern; p_worker_id kept for
-- signature symmetry with the 1-arg version, which also does not persist it).
revoke execute on function public.claim_autonomous_watch(text, uuid) from public, anon, authenticated;
