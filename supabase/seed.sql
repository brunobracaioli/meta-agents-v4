-- Local-dev seed (loaded automatically by `supabase db reset`; see config.toml [db.seed]).
--
-- Purpose: make local dev mirror PRODUCTION's per-operator model (AUTH_MODE=supabase)
-- against an ISOLATED local database — so enqueued agent_jobs carry a real operator_id,
-- instead of the single-password fallback (operator_id = null) that the runner can't claim.
--
-- Dev login (email mode):  bruno@b2tech.io  /  localdev123
-- The email mirrors the production operator's address ONLY for login ergonomics; this is a
-- SEPARATE, local-only account in an isolated DB (its own UUID + a weak local password). It is
-- NOT the production credential and shares nothing with prod. Never reuse this password anywhere.
-- NOTE: the address needs a real domain/TLD — the login endpoint validates with zod's
-- z.string().email(), which rejects dotless hosts like "dev@localhost" with a 400.
--
-- Idempotent: safe to run on every `db reset`. UUIDs are fixed for reproducibility.

-- pgcrypto provides crypt()/gen_salt(); pre-installed on Supabase, declared here for safety.
create extension if not exists pgcrypto with schema extensions;

-- 1) Auth user (gotrue). email pre-confirmed so no local mail server is required.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated',
  'bruno@b2tech.io',
  extensions.crypt('localdev123', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

-- 2) Identity row (required for email/password sign-in in gotrue v2).
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"bruno@b2tech.io","email_verified":true}'::jsonb,
  'email',
  now(), now(), now()
)
on conflict do nothing;

-- 3) Operator row. public.operators.id === auth.users.id (1:1). A trigger on auth.users may have
--    already auto-created this row (display_name = email, runner_status = 'none') when the user
--    above was inserted, so UPSERT to force 'active' + runner 'ready' (the enqueue gate
--    operatorRunnerReady requires both — there is no real Fly runner locally).
insert into public.operators (id, display_name, status, runner_status, connectors_status)
values (
  '11111111-1111-4111-8111-111111111111',
  'Local Dev Operator', 'active', 'ready', '{}'::jsonb
)
on conflict (id) do update
  set status = 'active', runner_status = 'ready', display_name = excluded.display_name;

-- 4) A dev client owned by the operator. ad_account_id is a PLACEHOLDER on purpose: local dev
--    must not drive the real Meta account. Point the runner/MCP at a sandbox if you run it E2E.
insert into public.clients (id, slug, name, ad_account_id, operator_id, daily_budget_cap_cents, currency, default_landing_url)
values (
  '22222222-2222-4222-8222-222222222222',
  'brunobracaioli', 'Bruno Bracaioli (local dev)', 'act_LOCALDEV',
  '11111111-1111-4111-8111-111111111111',
  5000, 'BRL', 'https://example.com'
)
on conflict (id) do nothing;
