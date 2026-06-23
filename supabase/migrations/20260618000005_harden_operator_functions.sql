-- Migration: harden_operator_functions
-- ADR: docs/adr/0026-multi-operator-tenancy.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
--
-- Closes two advisor findings from the previous migration (0008/0028/0029 linters):
--  * operator_owns_client() was SECURITY DEFINER and executable by anon via PostgREST RPC.
--    It doesn't need elevated rights: it can run as SECURITY INVOKER and lean on the
--    clients RLS policy (operator_id = auth.uid()) — same result, no privilege escalation,
--    no recursion (the clients policy is a simple column predicate, calls no function).
--    Kept executable by `authenticated` (RLS policies that reference it require EXECUTE);
--    revoked from public/anon.
--  * handle_new_operator() is a trigger-only function (fires on auth.users INSERT). Remove
--    its RPC surface; the trigger still fires regardless of EXECUTE grants (ADR 0008 pattern).

create or replace function public.operator_owns_client(p_client_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.operator_id = (select auth.uid())
  );
$$;

revoke execute on function public.operator_owns_client(uuid) from public, anon;
grant execute on function public.operator_owns_client(uuid) to authenticated;

revoke execute on function public.handle_new_operator() from public, anon, authenticated;