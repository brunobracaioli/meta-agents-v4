-- Phase 7 cutover (final step): drop the legacy single-tenant 1-arg claim functions.
--
-- The live Fly runner now sets OPERATOR_ID and uses the 2-arg, operator-scoped overloads
-- (poll-agent-jobs.sh → claim_agent_job(text, uuid); poll-autonomous-watches.sh →
-- claim_autonomous_watch(text, uuid)). AUTH_MODE=supabase stamps agent_jobs.operator_id, and a
-- real job has flowed end-to-end through the 2-arg path. The 1-arg overloads are now unused
-- (the web app only enqueues; claiming is runner-only), so they are removed.
--
-- ONE-WAY DOOR: this removes the single-tenant (no-OPERATOR_ID) claim path. To roll all the way
-- back to password/single-tenant you must recreate these from migrations 20260618000003
-- (claim_agent_job) and 20260604000001 (claim_autonomous_watch) AND unset OPERATOR_ID on the
-- runner. The 2-arg overloads are unaffected.

drop function if exists public.claim_agent_job(text);
drop function if exists public.claim_autonomous_watch(text);
