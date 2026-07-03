-- Migration: agent_jobs_create_google_ads_kind
-- Skill: .claude/skills/criacao-de-campanha-google-ads-ccaf-prep/SKILL.md
--
-- Novo kind 'create_google_ads': criação de campanha de Pesquisa (Search) no GOOGLE ADS
-- via connector MCP_GOOGLE_ADS_B2_TECH. Kind próprio (e não 'create') de propósito: o
-- índice de dedup é por (client_id, kind), então um pedido Google e um pedido Meta do
-- mesmo cliente podem coexistir pendentes, e o allowlist server-side (web/lib/ultron/
-- tools.ts) mapeia cada kind para a skill certa.

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','create_sales','create_google_ads','activate','analyze','summarize','landing','landing_publish','landing_edit','custom'));

-- Recria o dedup por cliente incluindo o novo kind (continua "um ativo por (cliente, kind)").
drop index public.agent_jobs_one_active_per_kind;
create unique index agent_jobs_one_active_per_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running')
    and kind in ('create','create_sales','create_google_ads','activate','analyze','summarize','landing');
