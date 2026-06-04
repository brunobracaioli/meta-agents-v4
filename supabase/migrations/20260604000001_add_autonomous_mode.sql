-- Migration: add_autonomous_mode
-- ADR: docs/adr/0019-ultron-autonomous-mode.md
-- Spec: docs/specs/SPEC-013-ultron-autonomous-mode.md
--
-- "Modo autônomo" do Ultron: depois que o operador enfileira uma tarefa longa (ex.: gerar
-- uma landing page) e sai, o Ultron monitora a execução sozinho, narra o progresso por voz,
-- e ao concluir revisa a página e notifica. Duas tabelas + uma RPC dão a espinha durável:
--
--   * autonomous_watches — o ESTADO do modo autônomo (o que observa, em que fase, cursor de
--     eventos já narrados). O supercronic da Fly faz polling e "claima" um watch por tick.
--   * ultron_narrations — o CANAL servidor→browser. A skill headless insere a fala; a aba do
--     Ultron faz polling (GET /api/ultron/narrations) e fala via TTS. Reusa o padrão da ADR
--     0007 (polling deny-by-default), NÃO Realtime — mantém RLS fechado.
--
-- Convenções (ADR 0002): updated_at via set_updated_at() trigger; RLS enabled deny-by-default
-- (service_role bypassa, ambos os lados escrevem com SUPABASE_SECRET_KEY). RPC com SECURITY
-- DEFINER + search_path='' e EXECUTE revogado de public/anon/authenticated (ADR 0008).

-- ---------- autonomous_watches ----------
create table public.autonomous_watches (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  -- target_kind é genérico de propósito (ADR 0019): v1 só observa 'landing_page', mas o
  -- schema já abre caminho p/ 'campaign'/'analysis' sem 2ª migração.
  target_kind   text not null default 'landing_page' check (target_kind in ('landing_page')),
  -- Resolvido só quando o alvo existe. Na criação de LP o landing_pages.id ainda não existe
  -- (a skill cria a linha), então começa null e é preenchido quando a página aparece.
  target_id     uuid,
  -- Pista p/ resolver o alvo antes de target_id existir (ex.: o subdomínio/nome da LP).
  target_hint   text,
  -- O agent_job que está sendo observado (criação) e o job de publicação que vem depois.
  agent_job_id  uuid references public.agent_jobs(id) on delete set null,
  publish_job_id uuid references public.agent_jobs(id) on delete set null,
  -- A aba do navegador (sessionStorage do Ultron) que deve FALAR as narrações deste watch.
  session_id    text not null,
  phase         text not null default 'watching'
                  check (phase in ('watching','reviewing','notifying','done','failed')),
  -- Cursor de idempotência: maior agent_events.ts já narrado + último marco textual narrado,
  -- p/ um re-tick não repetir fala.
  last_event_ts timestamptz,
  last_narrated_milestone text,
  result        jsonb not null default '{}'::jsonb,
  started_by    text not null default 'ultron',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index autonomous_watches_phase_idx on public.autonomous_watches (phase, updated_at);
create index autonomous_watches_client_id_idx on public.autonomous_watches (client_id);
create index autonomous_watches_session_idx on public.autonomous_watches (session_id);

-- Dedup: no máximo um watch ATIVO por agent_job observado (guarda contra um pedido de "modo
-- autônomo" duplicado/mal-ouvido). target_id começa null (nulls são distintos no unique), por
-- isso deduplicamos por agent_job_id, que já existe no momento do start.
create unique index autonomous_watches_one_active_per_job
  on public.autonomous_watches (agent_job_id)
  where phase in ('watching','reviewing','notifying') and agent_job_id is not null;

create trigger set_autonomous_watches_updated_at
  before update on public.autonomous_watches
  for each row execute function public.set_updated_at();

alter table public.autonomous_watches enable row level security;

-- ---------- ultron_narrations ----------
-- Append-only. Uma linha = uma fala que a aba do Ultron deve dizer (TTS). spoken_at é marcado
-- pelo browser depois de falar, p/ não repetir. image_path (Fase 2) referencia um print da
-- revisão no bucket privado.
create table public.ultron_narrations (
  id          uuid primary key default gen_random_uuid(),
  watch_id    uuid not null references public.autonomous_watches(id) on delete cascade,
  session_id  text not null,
  ts          timestamptz not null default now(),
  text        text not null,
  kind        text not null default 'status' check (kind in ('status','opinion','system')),
  image_path  text,
  spoken_at   timestamptz,
  created_at  timestamptz not null default now()
);
-- O browser faz GET por (session_id, ts > since): este índice serve esse polling.
create index ultron_narrations_session_ts_idx on public.ultron_narrations (session_id, ts);
create index ultron_narrations_watch_idx on public.ultron_narrations (watch_id);

alter table public.ultron_narrations enable row level security;

-- ---------- claim_autonomous_watch ----------
-- Atomic claim p/ o poller da Fly: pega UM watch ativo que está "due" (não tocado há >= a
-- cadência de narração) e bumpa updated_at p/ não ser re-claimado na próxima cadência. FOR
-- UPDATE SKIP LOCKED torna pollers concorrentes seguros. ~90s de cadência: com o cron de 1 min,
-- cada watch é narrado a cada ~2 min (o "X" do "atualização a cada X" pedido no SPEC-013).
create or replace function public.claim_autonomous_watch(p_worker_id text)
returns setof public.autonomous_watches
language sql
security definer
set search_path = ''
as $$
  update public.autonomous_watches
     set updated_at = now()
   where id = (
     select id
       from public.autonomous_watches
      where phase in ('watching','reviewing','notifying')
        and updated_at < now() - interval '90 seconds'
      order by updated_at asc
      limit 1
      for update skip locked
   )
  returning *;
$$;

-- Least privilege: só service_role pode claimar (ADR 0008 / migration 0004 pattern).
revoke execute on function public.claim_autonomous_watch(text) from public, anon, authenticated;
