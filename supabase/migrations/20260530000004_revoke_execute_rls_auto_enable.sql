-- Migration: revoke_execute_rls_auto_enable
-- ADR: docs/adr/0008-revoke-public-execute-rls-auto-enable.md
--
-- public.rls_auto_enable() is a SECURITY DEFINER event-trigger function (backing the
-- `ensure_rls` ddl_command_end trigger that auto-enables RLS on new public tables).
-- EXECUTE was granted to PUBLIC, exposing it via PostgREST RPC (advisors 0028/0029).
-- Revoke EXECUTE from PUBLIC/anon/authenticated to remove the RPC surface. This does
-- NOT disable the event trigger (event triggers fire regardless of EXECUTE grants).
-- postgres (owner) and service_role keep access; SECURITY DEFINER + pinned search_path
-- (pg_catalog) are intentionally preserved.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
