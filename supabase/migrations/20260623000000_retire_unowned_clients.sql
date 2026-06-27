-- Migration: retire_unowned_clients (backfill for the Phase 7 cutover)
--
-- 20260623000001 enforces clients.operator_id NOT NULL. Its own comment notes the cutover
-- "retired the legacy stub client" and backfilled the rest to operator #1 — but that data step
-- was done OUT OF BAND in production. On a from-scratch rebuild the brunobracaioli client seeded
-- by 20260530000003 has no operator_id, so the NOT NULL alter fails.
--
-- Reproduce the cutover's intent: drop any client that still has no operator before the constraint
-- is enforced. In production this matches 0 rows (every client was already backfilled) -> no-op.
-- On a fresh/local build it clears the unowned seed client; seed.sql then recreates an OWNED dev
-- client + operator (it runs last, when auth.users is available for the operator FK).

delete from public.clients where operator_id is null;
