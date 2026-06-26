-- SPEC-019 Wave C.2 — let an autonomous narration carry an ARC render directive.
--
-- Additive + nullable: NULL means "no render" (the current behavior, fully backward compatible).
-- When present, it holds a UIIntent[] (the same contract the chat loop returns under `uiIntents`)
-- that the operator's ARC tab pushes to the Render Bus as it speaks the narration — so the
-- autonomous mode can materialize a panel ("os agents fizeram X" → panel + voice). The payload is
-- re-validated by Zod (parseUIIntents) on the client, so a malformed value is ignored, never spoken.
-- RLS is inherited from ultron_narrations (deny-by-default; reads go through the service key per ADR 0007).

ALTER TABLE public.ultron_narrations
  ADD COLUMN IF NOT EXISTS render jsonb;

COMMENT ON COLUMN public.ultron_narrations.render IS
  'SPEC-019 Wave C.2: optional UIIntent[] the ARC client pushes to the Render Bus when this narration is spoken. NULL = no render (legacy).';
