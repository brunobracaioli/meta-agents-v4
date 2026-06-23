-- Migration: add_operators
-- ADR: docs/adr/0026-multi-operator-tenancy.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
--
-- Operators are the platform users (Supabase Auth). One operator owns N clients
-- (clients.operator_id, added in the next migration) and runs a dedicated Fly runner
-- (ADR 0027) authenticated with their own Anthropic account + claude.ai connectors.
-- public.operators is 1:1 with auth.users (id = auth.uid()), holding status and the
-- runner provisioning state. A trigger auto-creates the operators row on signup.
--
-- RLS: enabled. authenticated may read only their own row (auth.uid()); writes
-- (status, runner_status, connectors_status) are system-side via service_role.

create table public.operators (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text,
  status             text not null default 'active' check (status in ('active','suspended')),
  fly_app_name       text unique,
  runner_status      text not null default 'none'
                       check (runner_status in ('none','provisioned','ready','error')),
  connectors_status  jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_operators_updated_at
  before update on public.operators
  for each row execute function public.set_updated_at();

-- Auto-provision the operators row when a Supabase Auth user is created. Standard
-- Supabase pattern (mirrors a profiles table). SECURITY DEFINER + pinned search_path.
create or replace function public.handle_new_operator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.operators (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_operator();

-- RLS: enabled (the ensure_rls event trigger also auto-enables; explicit for clarity).
alter table public.operators enable row level security;

-- An operator can read only their own row.
create policy operators_select_self on public.operators
  for select to authenticated
  using (id = (select auth.uid()));
