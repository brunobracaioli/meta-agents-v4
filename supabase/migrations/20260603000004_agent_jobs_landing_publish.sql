-- Migration: agent_jobs_landing_publish
-- ADR: docs/adr/0015-editable-landing-pages-supabase-draft.md
-- Spec: docs/specs/SPEC-012-landing-page-editor.md
--
-- Novos kinds para o editor: 'landing_publish' (serializa o rascunho do Supabase →
-- build → wrangler deploy no Cloudflare) e 'landing_edit' (edições caras que precisam da
-- VM, ex.: regenerar imagem). Edições baratas de texto/tokens NÃO viram job — o Vercel
-- aplica direto no Supabase.
--
-- Dedup: os kinds antigos seguem "um ativo por (cliente, kind)". Mas como um cliente pode
-- ter VÁRIAS landing pages, publish/edit precisam deduplicar por (landing_page_id, kind),
-- não por cliente — senão publicar a LP A bloquearia publicar a LP B do mesmo cliente.
-- Por isso adicionamos landing_page_id e recriamos o índice antigo excluindo os kinds
-- per-LP, com um índice dedicado per-LP para publish/edit.

alter table public.agent_jobs drop constraint agent_jobs_kind_check;
alter table public.agent_jobs add constraint agent_jobs_kind_check
  check (kind in ('create','activate','analyze','summarize','landing','landing_publish','landing_edit'));

alter table public.agent_jobs
  add column landing_page_id uuid references public.landing_pages(id) on delete cascade;
create index agent_jobs_landing_page_id_idx on public.agent_jobs (landing_page_id);

-- Recria o dedup por cliente, agora restrito aos kinds que NÃO são per-LP.
drop index public.agent_jobs_one_active_per_kind;
create unique index agent_jobs_one_active_per_kind
  on public.agent_jobs (client_id, kind)
  where status in ('pending','claimed','running')
    and kind in ('create','activate','analyze','summarize','landing');

-- Dedup per-LP: no máximo um publish/edit em voo por landing page (permite N LPs do
-- mesmo cliente publicando em paralelo).
create unique index agent_jobs_one_active_per_lp_kind
  on public.agent_jobs (landing_page_id, kind)
  where status in ('pending','claimed','running')
    and kind in ('landing_publish','landing_edit');
