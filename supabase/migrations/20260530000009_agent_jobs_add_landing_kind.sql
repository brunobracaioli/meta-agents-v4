-- Migration: agent_jobs_add_landing_kind
-- ADR: docs/adr/0012-landing-pages-on-cloudflare-pages.md
-- Spec: docs/specs/SPEC-011-landing-page-generation.md
--
-- Permite que o Ultron enfileire criação de landing page (kind='landing'), executada
-- pela skill create-landing-page-brunobracaioli no runner Fly. O índice único parcial
-- agent_jobs_one_active_per_kind (client_id, kind) já existente passa a deduplicar
-- também os jobs de landing. claim_agent_job é genérico — sem mudança.

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','activate','analyze','summarize','landing'));
