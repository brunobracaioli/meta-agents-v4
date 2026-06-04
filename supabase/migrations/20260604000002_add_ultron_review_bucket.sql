-- Migration: add_ultron_review_bucket
-- ADR: docs/adr/0019-ultron-autonomous-mode.md (Fase 2 — revisão visual server-side)
-- Spec: docs/specs/SPEC-013-ultron-autonomous-mode.md §3.4 / §6 Fase 2
--
-- Private Storage bucket for the autonomous-mode visual review (Fase 2): the headless
-- screenshotter (scripts/screenshot-page.cjs, Playwright on the Fly runner) opens the DEPLOYED
-- landing page and uploads viewport prints here; the watch-tick skill downloads each print,
-- looks at it (vision) and narrates an opinion (ultron_narrations.image_path references the
-- object). Private on purpose — the prints are internal audit artifacts, never public. Both
-- writer (runner) and reader (skill) use the Supabase service key, which bypasses RLS, so no
-- storage policies are needed (same access model as the private `creatives` bucket).

insert into storage.buckets (id, name, public)
values ('ultron-review', 'ultron-review', false)
on conflict (id) do nothing;
