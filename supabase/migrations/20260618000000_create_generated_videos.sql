-- Migration: create_generated_videos (backfill of an out-of-band table)
--
-- public.generated_videos (Seedance video generation, ADR 0022) was created out-of-band and
-- never captured in a migration. Migration 20260618000004_rls_policies_per_operator references
-- it (`create policy generated_videos_select_own on public.generated_videos`), so a from-scratch
-- rebuild failed: relation did not exist. This backfills the table BEFORE 000004.
--
-- Idempotent (create table if not exists): harmless where the table already exists (production).
-- RLS is auto-enabled by the `ensure_rls` event trigger on creation; the per-operator SELECT
-- policy is added by 20260618000004, matching prod.

create table if not exists public.generated_videos (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  variant_key      text,
  storage_bucket   text not null,
  storage_path     text not null,
  public_url       text,
  mode             text,
  aspect           text,
  duration_seconds integer,
  resolution       text,
  channel          text,
  quality_tier     text,
  generate_audio   boolean,
  mime_type        text default 'video/mp4',
  model            text default 'seedance2',
  prompt           text,
  seedance_task_id text,
  seed             bigint,
  credits_used     integer,
  cost_credits     integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
