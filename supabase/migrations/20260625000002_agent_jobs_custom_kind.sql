-- Migration: agent_jobs_custom_kind
-- ADR: docs/adr/0030-user-defined-skills.md
-- Spec: docs/specs/SPEC-018-client-and-skill-management.md
--
-- New kind 'custom' for operator-authored skills (client_skills). The job carries skill_id so the
-- runner can materialize the SKILL.md from the DB, and so the run is traceable back to the skill.
-- Dedup is PER SKILL (a client can have many custom skills) — keyed on (client_id, skill_id),
-- unlike the per-(client,kind) index used by the fixed kinds. on delete set null: deleting a skill
-- must not erase the audit trail of jobs it produced.

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','create_sales','activate','analyze','summarize','landing','landing_publish','landing_edit','custom'));

alter table public.agent_jobs
  add column skill_id uuid references public.client_skills(id) on delete set null;
create index agent_jobs_skill_id_idx on public.agent_jobs (skill_id);

-- At most one in-flight job per (client, custom skill): a re-trigger (voice/schedule/manual)
-- while one is still running fails with a unique violation, surfaced as "já em andamento".
create unique index agent_jobs_one_active_per_custom_skill
  on public.agent_jobs (client_id, skill_id)
  where status in ('pending','claimed','running') and kind = 'custom';
