-- Migration: create_rls_auto_enable (backfill of an out-of-band object)
--
-- public.rls_auto_enable() + the `ensure_rls` event trigger auto-enable RLS on every new
-- public table. In production these were created out-of-band during the 2026-05-30 schema
-- reset and were NEVER captured in a migration. As a result migration
-- 20260530000004_revoke_execute_rls_auto_enable (which REVOKEs EXECUTE on the function)
-- failed on any from-scratch rebuild: the function did not exist.
--
-- This migration backfills them so `supabase db reset` / `supabase start` is reproducible and
-- mirrors prod: the trigger exists BEFORE 0001 creates tables, so those tables get RLS
-- auto-enabled exactly like in production. Versioned at ...000000 to run before 0001.
--
-- Fully idempotent (CREATE OR REPLACE + guarded CREATE EVENT TRIGGER): harmless if ever applied
-- to an environment that already has these objects (e.g. production already does).

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end $$;
