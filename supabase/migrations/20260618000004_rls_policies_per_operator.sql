-- Migration: rls_policies_per_operator
-- ADR: docs/adr/0026-multi-operator-tenancy.md
-- Spec: docs/specs/SPEC-017-multi-operator-multitenant.md
-- Threat model: docs/security/threats/multi-operator.md
--
-- Adds per-operator RLS SELECT policies so the web dashboard, when reading with the
-- operator's Supabase Auth JWT (role `authenticated`), sees ONLY rows belonging to clients
-- it owns. Writes stay system-side via service_role (which bypasses RLS): the runner and
-- the enqueue API are the only writers. This is the DB-level backstop behind the app-level
-- ownership guards (defense in depth).
--
-- Helper operator_owns_client() is SECURITY DEFINER so it reads clients without recursing
-- through clients' own RLS policy. Rows with client_id IS NULL evaluate to false → invisible
-- to authenticated (safe), still visible to service_role.

create or replace function public.operator_owns_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.operator_id = (select auth.uid())
  );
$$;

grant execute on function public.operator_owns_client(uuid) to authenticated;

-- clients: an operator sees only its own clients.
create policy clients_select_own on public.clients
  for select to authenticated
  using (operator_id = (select auth.uid()));

-- Direct client_id tables.
create policy campaigns_select_own on public.campaigns
  for select to authenticated using (public.operator_owns_client(client_id));

create policy creatives_select_own on public.creatives
  for select to authenticated using (public.operator_owns_client(client_id));

create policy generated_images_select_own on public.generated_images
  for select to authenticated using (public.operator_owns_client(client_id));

create policy generated_videos_select_own on public.generated_videos
  for select to authenticated using (public.operator_owns_client(client_id));

create policy operation_logs_select_own on public.operation_logs
  for select to authenticated using (public.operator_owns_client(client_id));

create policy analyses_select_own on public.analyses
  for select to authenticated using (public.operator_owns_client(client_id));

create policy metric_snapshots_select_own on public.metric_snapshots
  for select to authenticated using (public.operator_owns_client(client_id));

create policy analysis_findings_select_own on public.analysis_findings
  for select to authenticated using (public.operator_owns_client(client_id));

create policy daily_summaries_select_own on public.daily_summaries
  for select to authenticated using (public.operator_owns_client(client_id));

create policy agent_events_select_own on public.agent_events
  for select to authenticated using (public.operator_owns_client(client_id));

create policy agent_jobs_select_own on public.agent_jobs
  for select to authenticated using (public.operator_owns_client(client_id));

create policy products_select_own on public.products
  for select to authenticated using (public.operator_owns_client(client_id));

create policy landing_pages_select_own on public.landing_pages
  for select to authenticated using (public.operator_owns_client(client_id));

create policy autonomous_watches_select_own on public.autonomous_watches
  for select to authenticated using (public.operator_owns_client(client_id));

create policy funnel_events_select_own on public.funnel_events
  for select to authenticated using (public.operator_owns_client(client_id));

create policy lp_events_select_own on public.lp_events
  for select to authenticated using (public.operator_owns_client(client_id));

-- Tables scoped via a parent FK (no direct client_id).
create policy ad_sets_select_own on public.ad_sets
  for select to authenticated
  using (exists (
    select 1 from public.campaigns c
     where c.id = ad_sets.campaign_id
       and public.operator_owns_client(c.client_id)
  ));

create policy ads_select_own on public.ads
  for select to authenticated
  using (exists (
    select 1 from public.ad_sets s
     where s.id = ads.ad_set_id
       and exists (
         select 1 from public.campaigns c
          where c.id = s.campaign_id
            and public.operator_owns_client(c.client_id)
       )
  ));

create policy landing_page_sections_select_own on public.landing_page_sections
  for select to authenticated
  using (exists (
    select 1 from public.landing_pages lp
     where lp.id = landing_page_sections.landing_page_id
       and public.operator_owns_client(lp.client_id)
  ));

create policy ultron_narrations_select_own on public.ultron_narrations
  for select to authenticated
  using (exists (
    select 1 from public.autonomous_watches w
     where w.id = ultron_narrations.watch_id
       and public.operator_owns_client(w.client_id)
  ));
