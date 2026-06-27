-- Migration: grant_select_landing_tables_to_authenticated
-- ADR: docs/adr/0026-multi-operator-auth-mode-cutover.md
-- Spec: SPEC-018 / NOTES.md §16 (Fase 7 cutover)
--
-- Fix de produção (digest 3981437682): com AUTH_MODE=supabase (Fase 7), as leituras do
-- dashboard rodam como role `authenticated` (web/lib/db/read-client.ts). A rota
-- /lp-preview/[id] (e o card de landing do ARC que a embute num iframe) falhava com
-- 500 / Postgres 42501 "permission denied for table landing_pages".
--
-- Causa: a migration 20260603000005_landing_editor_rls_hardening REVOGOU os grants de
-- tabela de anon/authenticated quando o modelo era "service_role-only" (AUTH_MODE=password).
-- A migration 20260618000004_rls_policies_per_operator criou as policies SELECT
-- `*_select_own` para `authenticated`, mas NÃO restaurou o GRANT SELECT — e o Postgres
-- checa o grant de tabela ANTES da RLS, então a query nega antes da policy rodar.
--
-- Esta migration restaura SOMENTE o SELECT para `authenticated` (escrita continua via
-- service_role no servidor — least privilege preservado). É seguro porque a RLS está
-- habilitada e as policies `*_select_own` já restringem as linhas via
-- operator_owns_client(client_id). Idempotente.

grant select on table public.landing_pages         to authenticated;
grant select on table public.landing_page_sections to authenticated;
grant select on table public.products              to authenticated;
