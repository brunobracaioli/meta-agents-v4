-- Migration: landing_editor_rls_hardening
-- ADR: docs/adr/0015-editable-landing-pages-supabase-draft.md
-- Spec: docs/specs/SPEC-012-landing-page-editor.md
-- Threat model: docs/security/threats/landing-page-editor.md
--
-- Hardening da superfície de dados do editor de landing pages (Wave 6). As tabelas
-- products, landing_page_sections e landing_pages já têm RLS habilitado deny-by-default
-- (sem policies) desde a criação — a postura correta, porque TODO acesso é via service_role
-- no servidor (o web fala com o Hono API com a service key; o runner Fly usa REST + service
-- key). NÃO existe caminho de acesso anon/authenticated direto: o dashboard nunca usa a
-- publishable key contra estas tabelas. RLS-on + zero-policy já nega anon/authenticated.
--
-- Esta migration adiciona DEFESA EM PROFUNDIDADE (least privilege): além do RLS negar linhas,
-- REVOGA os próprios grants de tabela de anon/authenticated, removendo a tabela da superfície
-- exposta pelo PostgREST. Mesma estratégia da migration 0004 (revoke de EXECUTE). service_role
-- (e postgres owner) mantêm acesso e seguem bypassando RLS. Idempotente e segura: revogar um
-- grant inexistente é no-op.
--
-- IMPORTANTE: nenhuma policy permissiva é adicionada — adicionar uma ENFRAQUECERIA a postura.
-- O modelo é intencionalmente "service_role-only".

revoke all on table public.products             from anon, authenticated;
revoke all on table public.landing_page_sections from anon, authenticated;
revoke all on table public.landing_pages         from anon, authenticated;

comment on table public.products is
  'Read-model cliente→produto→LP (SPEC-012). RLS deny-by-default; acesso só via service_role (server). Sem policies por design — ver docs/security/threats/landing-page-editor.md.';
comment on table public.landing_page_sections is
  'Blocos editáveis (fonte de verdade do rascunho, SPEC-012). RLS deny-by-default; acesso só via service_role. `fields` é validado por whitelist por tipo na fronteira de escrita (web/lib/landing/section-schemas.ts), não no banco.';
comment on table public.landing_pages is
  'Landing pages (deploy + rascunho). RLS deny-by-default; acesso só via service_role. settings/theme validados por Zod na fronteira de escrita.';
