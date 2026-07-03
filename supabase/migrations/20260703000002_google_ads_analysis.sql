-- Migration: google_ads_analysis
-- Skill: .claude/skills/google-ads-analytics-brunobracaioli/SKILL.md
--
-- Estende o schema de análise (ADR 0004) para acomodar análises de GOOGLE ADS ao lado
-- das de Meta, reusando as mesmas tabelas e o mesmo dashboard (/dashboard/analyses):
--   1. analyses.channel discrimina o canal ('meta' default preserva o histórico).
--   2. level ganha 'ad_group' (tier intermediário do Google) e 'keyword' (findings de
--      search terms). meta_entity_id continua text e carrega o resource_name do Google.
--   3. recommendation_type ganha as ações típicas de Search: negativar termo e ajustar
--      keyword.
--   4. agent_jobs ganha o kind 'analyze_google' (disparo sob demanda via Ultron) — kind
--      próprio para que uma análise Google e uma Meta do mesmo cliente possam coexistir
--      pendentes (dedup é por (client_id, kind)).

alter table public.analyses
  add column channel text not null default 'meta'
  check (channel in ('meta','google_ads'));

alter table public.metric_snapshots drop constraint metric_snapshots_level_check;
alter table public.metric_snapshots add constraint metric_snapshots_level_check
  check (level in ('campaign','ad_set','ad_group','ad','keyword'));

alter table public.analysis_findings drop constraint analysis_findings_level_check;
alter table public.analysis_findings add constraint analysis_findings_level_check
  check (level in ('campaign','ad_set','ad_group','ad','keyword'));

alter table public.analysis_findings drop constraint analysis_findings_recommendation_type_check;
alter table public.analysis_findings add constraint analysis_findings_recommendation_type_check
  check (recommendation_type in ('observe','rotate_creative','pause_loser','adjust_audience','fix_landing_page','reallocate_budget','scale','add_negative_keywords','adjust_keywords','none'));

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','create_sales','create_google_ads','activate','analyze','analyze_google','summarize','landing','landing_publish','landing_edit','custom'));

-- Recria o dedup por cliente incluindo o novo kind (continua "um ativo por (cliente, kind)").
drop index public.agent_jobs_one_active_per_kind;
create unique index agent_jobs_one_active_per_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running')
    and kind in ('create','create_sales','create_google_ads','activate','analyze','analyze_google','summarize','landing');
