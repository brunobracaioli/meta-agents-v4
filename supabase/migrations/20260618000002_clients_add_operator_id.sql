-- Migration: clients_add_operator_id
-- ADR: docs/adr/0026-multi-operator-tenancy.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
--
-- Each client belongs to exactly one operator (1:N). Added NULLABLE here: the backfill
-- (assigning the existing brunobracaioli client to operator #1) happens at the Phase 7
-- cutover, AFTER bruno signs up via Supabase Auth and gets an auth.users id. A follow-up
-- migration then sets NOT NULL. on delete restrict prevents deleting an operator that
-- still owns clients.
--
-- RLS note: until backfilled, rows with operator_id IS NULL are invisible to authenticated
-- (the per-operator policies require operator_id = auth.uid()); service_role still sees all.

alter table public.clients
  add column operator_id uuid references public.operators(id) on delete restrict;

create index clients_operator_id_idx on public.clients (operator_id);
