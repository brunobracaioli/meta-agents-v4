-- Migration: add_client_skills
-- ADR: docs/adr/0030-user-defined-skills.md
-- Spec: docs/specs/SPEC-018-client-and-skill-management.md
-- Threat model: docs/security/threats/user-defined-skills.md
--
-- Operator-authored skills (automations). They CANNOT be written to the runner image, so they
-- live here and are materialized into an ephemeral SKILL.md at runtime by run-skill.sh, then run
-- through the existing `claude -p` path. `body` is plain instructions — NEVER a secret (connectors
-- live in the runner's ~/.claude, ADR 0027). `allowed_tools` becomes the SKILL.md frontmatter
-- allow-list; `capability` gates whether the skill may do Meta writes (defense alongside budget
-- caps + PAUSED-by-default). operator_id is denormalized (like agent_jobs) for RLS + scoped claim.
--
-- RLS: authenticated operators SELECT their own (dashboard reads via the operator JWT). Writes are
-- system-side via service_role + an app-level ownership guard — no INSERT/UPDATE/DELETE policy for
-- authenticated (defense in depth, mirrors clients/landing_pages).

create table public.client_skills (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  operator_id    uuid not null references public.operators(id) on delete cascade,
  slug           text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name           text not null,
  description    text,
  body           text not null,
  allowed_tools  text[] not null default '{}',
  capability     text not null default 'read' check (capability in ('read','write')),
  ultron_enabled boolean not null default false,
  ultron_function jsonb,
  status         text not null default 'draft' check (status in ('draft','active','disabled')),
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_id, slug)
);

create index client_skills_operator_idx on public.client_skills (operator_id);
create index client_skills_client_idx on public.client_skills (client_id);
-- Hot path for the Ultron dynamic-tool lookup: an operator's active, Ultron-exposed skills.
create index client_skills_ultron_idx on public.client_skills (operator_id)
  where ultron_enabled and status = 'active';

create trigger set_client_skills_updated_at before update on public.client_skills
  for each row execute function public.set_updated_at();

alter table public.client_skills enable row level security;

create policy client_skills_select_own on public.client_skills
  for select to authenticated
  using (operator_id = (select auth.uid()));
