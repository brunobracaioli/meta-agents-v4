-- Migration: skills_product_scope
-- ADR: docs/adr/0030-user-defined-skills.md
-- Spec: docs/specs/SPEC-018-client-and-skill-management.md
--
-- Re-scope operator-authored skills from CLIENT to PRODUCT (operador → cliente → produto → skill).
-- A client has N products (different prices/info); skills belong to a product. The skill tables keep
-- client_id (denormalized, for the runner/ad-account resolution + the agent_jobs dedup index) and
-- GAIN a product_id. Tables are empty in every environment (feature unmerged, test data purged), so
-- product_id can be NOT NULL directly. The slug is now unique PER PRODUCT (two products of the same
-- client may have a skill with the same slug).

-- client_skills: product_id NOT NULL + re-key the unique to (product_id, slug).
alter table public.client_skills
  add column product_id uuid not null references public.products(id) on delete cascade;
alter table public.client_skills drop constraint client_skills_client_id_slug_key;
alter table public.client_skills add constraint client_skills_product_id_slug_key unique (product_id, slug);
create index client_skills_product_id_idx on public.client_skills (product_id);

-- skill_schedules: denormalized product_id NOT NULL (mirrors client_id/operator_id).
alter table public.skill_schedules
  add column product_id uuid not null references public.products(id) on delete cascade;
create index skill_schedules_product_id_idx on public.skill_schedules (product_id);

-- agent_jobs: product_id nullable (only custom jobs carry it; for traceability + runtime resolution).
-- The one-active-per-custom-skill index stays keyed on (client_id, skill_id) — skill_id is unique.
alter table public.agent_jobs
  add column product_id uuid references public.products(id) on delete set null;
create index agent_jobs_product_id_idx on public.agent_jobs (product_id);
