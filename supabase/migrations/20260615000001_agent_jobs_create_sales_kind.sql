-- Migration: agent_jobs_create_sales_kind
-- Skill: .claude/skills/create-sales-brunobracaioli-campaign/SKILL.md
--
-- Novo kind 'create_sales': criação de campanha de VENDAS (OUTCOME_SALES) reusando os
-- criativos "top vendas" da conta. É distinto de 'create' (tráfego) de propósito — assim
-- um pedido de vendas e um de tráfego do mesmo cliente podem coexistir pendentes (o índice
-- de dedup é por (client_id, kind)), e o allowlist server-side mapeia cada kind para a
-- skill certa.

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','create_sales','activate','analyze','summarize','landing','landing_publish','landing_edit'));

-- Recria o dedup por cliente incluindo o novo kind (continua "um ativo por (cliente, kind)").
drop index public.agent_jobs_one_active_per_kind;
create unique index agent_jobs_one_active_per_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running')
    and kind in ('create','create_sales','activate','analyze','summarize','landing');
