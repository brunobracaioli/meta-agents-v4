-- Phase 7 cutover: every client now belongs to an operator.
-- Backfill ran first (clients.operator_id set to operator #1 / bruno), the empty
-- legacy "imobiliaria" stub client was retired, so no NULL rows remain. Enforce the
-- 1:N ownership invariant (clients.operator_id was nullable since 20260618000002).
alter table public.clients alter column operator_id set not null;
