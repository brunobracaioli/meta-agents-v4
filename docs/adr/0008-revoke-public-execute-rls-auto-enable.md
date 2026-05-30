# ADR 0008 — Revogar EXECUTE público da função SECURITY DEFINER `rls_auto_enable`

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-30 |
| Decidido por | brunobracaioli |
| Migrations | `revoke_execute_rls_auto_enable` |
| Relacionado | [ADR 0002](0002-supabase-meta-ads-persistence-schema.md) (deixou esta dívida em aberto) |

## Context

A função `public.rls_auto_enable()` é o corpo de um **event trigger** ativo (`ensure_rls`,
em `ddl_command_end`, owner `postgres`) que habilita RLS automaticamente em toda tabela
nova criada no schema `public`. É um mecanismo de defesa em profundidade legítimo e
desejável — alinhado com "RLS deny-by-default" do ADR 0002.

O ADR 0002 deixou explicitamente em aberto a decisão sobre os advisors **0028/0029**
(`anon`/`authenticated_security_definer_function_executable`): a função é
`SECURITY DEFINER` e tem `EXECUTE` concedido a `PUBLIC` (logo `anon` e `authenticated`),
ficando exposta via PostgREST como RPC em `/rest/v1/rpc/rls_auto_enable`. A função
sobreviveu ao reset do banco de 2026-05-30 (não faz parte do nosso schema versionado;
é parte da configuração do projeto Supabase) e os WARN voltaram a aparecer.

Expor uma função `SECURITY DEFINER` ao `anon` fere o princípio de menor privilégio
(`~/.claude/rules/security.md`). Na prática o risco de execução direta é baixo —
`pg_event_trigger_ddl_commands()` só retorna dados dentro de um contexto de event
trigger, então uma chamada RPC avulsa falharia —, mas a superfície não deve existir.

## Decision

**Revogar `EXECUTE` da função `public.rls_auto_enable()` de `PUBLIC`, `anon` e
`authenticated`.** Não dropar a função nem o event trigger, não trocar para
`SECURITY INVOKER`.

Justificativa de cada escolha:

- **Manter a função e o event trigger `ensure_rls`** — é um controle de segurança útil
  (RLS automático em tabelas novas), não uma dívida a remover.
- **Manter `SECURITY DEFINER`** — a função precisa alterar tabelas que não são de sua
  propriedade (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`); como `SECURITY INVOKER`
  ela falharia para DDL executado por roles sem privilégio sobre a tabela. O
  `search_path` já está pinado a `pg_catalog` (hardening contra hijack).
- **Revogar `EXECUTE` em vez de mover de schema** — event triggers disparam pelo
  mecanismo do trigger, **independentemente** do privilégio `EXECUTE` na função.
  Revogar `EXECUTE` de `PUBLIC`/`anon`/`authenticated` remove a exposição via RPC do
  PostgREST **sem** afetar o auto-RLS. `postgres` (owner) e `service_role` mantêm acesso.

## Consequences

### Positivas
- Advisors 0028/0029 (`anon`/`authenticated_security_definer_function_executable`)
  resolvidos. Superfície de ataque via RPC eliminada.
- Auto-RLS em tabelas novas preservado (defesa em profundidade intacta).
- Fecha a dívida aberta no ADR 0002.

### Negativas / dívidas
- Permanecem os 10 INFO `rls_enabled_no_policy` (RLS on, sem policy) — dívida aceita
  até o app multi-tenant definir policies (ADR 0002/0004), inalterada por esta decisão.
