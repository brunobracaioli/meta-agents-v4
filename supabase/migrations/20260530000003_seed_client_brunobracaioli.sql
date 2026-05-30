-- Migration: seed_client_brunobracaioli
-- Seeds the brunobracaioli client row required by both Fly.io cron skills.
-- Both skills do `SELECT id FROM clients WHERE slug='brunobracaioli'` and abort if absent.
-- Source of truth: .claude/skills/lista-de-clientes/SKILL.md
-- Idempotent: re-running refreshes the known columns without duplicating.

insert into public.clients (
  slug, name, ad_account_id, business_manager_id, facebook_page_id,
  default_landing_url, daily_budget_cap_cents, currency, materials_path
) values (
  'brunobracaioli',
  'brunobracaioli — Claude Code Architect (CCA)',
  '225179730538661',
  '772813643612039',
  '867347659802006',
  'https://cca.b2tech.io',
  5000,
  'BRL',
  '.claude/materiais-das-empresas/brunobracaioli/'
)
on conflict (slug) do update set
  name                   = excluded.name,
  ad_account_id          = excluded.ad_account_id,
  business_manager_id    = excluded.business_manager_id,
  facebook_page_id       = excluded.facebook_page_id,
  default_landing_url    = excluded.default_landing_url,
  daily_budget_cap_cents = excluded.daily_budget_cap_cents,
  currency               = excluded.currency,
  materials_path         = excluded.materials_path;
