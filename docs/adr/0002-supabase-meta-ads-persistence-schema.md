# ADR 0002 — Schema de persistência da agência Meta Ads no Supabase Postgres

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-23 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/meta-ads-persistence-schema.md](../specs/meta-ads-persistence-schema.md) |
| Migrations | `init_meta_ads_agency_schema`, `harden_set_updated_at_search_path` |

## Context

O CLAUDE.md exige que "as informações de cada campanha, conjuntos, anúncios,
creativos, o que foi criado, edições etc." sejam salvas no Supabase. O projeto
era um template e o banco estava **vazio** (0 tabelas, 0 migrations) — confirmado
via `list_tables`/`list_migrations`. A primeira campanha real (CCA, cliente
`brunobracaioli`) já tinha sido criada no Meta sem nenhuma persistência relacional,
só com os PNGs no Storage (bucket privado `creatives`).

Precisávamos de um schema que (a) espelhasse a hierarquia do Meta para reconciliar
estado, (b) guardasse os assets gerados e a copy, e (c) deixasse trilha de auditoria
do que cada agente criou/editou.

## Decision

Criamos 7 tabelas em `public` via migration declarativa (`apply_migration`):
`clients`, `campaigns`, `ad_sets`, `creatives`, `generated_images`, `ads`,
`operation_logs`. A hierarquia segue Meta (`client → campaign → ad_set → ad`),
com `creatives` e `generated_images` como assets referenciados por `ads`/`creatives`.

Decisões transversais:

- **IDs do Meta como `text`** (não `bigint`): são identificadores opacos e externos;
  evitamos premissas sobre faixa numérica e facilitamos `ON CONFLICT` para upsert
  idempotente de reconciliação.
- **Dinheiro em `integer` cents** (`daily_budget_cents` etc.): a própria Marketing API
  trabalha em cents; elimina drift de ponto flutuante.
- **`raw_spec`/`targeting` em `jsonb`**: guarda a resposta crua do MCP para auditoria
  e replay sem precisar modelar cada campo opcional do Meta.
- **`updated_at` via trigger** `set_updated_at()` (com `search_path` pinado a `''`,
  hardening do advisor 0011).
- **RLS habilitado deny-by-default em todas as tabelas, sem policies.** O agente
  opera com `service_role`, que **bypassa RLS**. Nenhum acesso `anon`/`authenticated`
  é concedido até o app com Supabase Auth definir suas próprias policies.

### Por que não usar `bigint` para os IDs do Meta

IDs do Meta hoje cabem em `bigint`, mas são semânticamente strings opacas. `text`
é à prova de futuro e torna os upserts de reconciliação triviais.

### Por que RLS sem policy em vez de não habilitar RLS

Tabela em `public` sem RLS fica exposta via PostgREST a quem tiver a anon key.
RLS habilitado sem policy é deny-by-default: PostgREST não devolve nada para
`anon`/`authenticated`, e o `service_role` (usado pelo agente) ignora RLS. É o
estado seguro para tabelas internas sem consumidor de frontend ainda definido.

## Consequences

### Positivas

- Estado do Meta reconciliável e auditável; copy e assets versionados no banco.
- Upsert idempotente: reprocessar a mesma campanha não duplica linhas.
- Schema seguro por padrão (RLS on) — advisors de segurança só acusam INFO esperado.

### Negativas / dívidas

- Os 7 avisos `rls_enabled_no_policy` (INFO) permanecem até o app definir policies
  por usuário/tenant. Aceito conscientemente.
- Função pré-existente `public.rls_auto_enable` (SECURITY DEFINER, executável por
  `anon` via RPC) **não foi criada nesta mudança** e segue sinalizada pelos advisors
  0028/0029 — decidir em ADR futuro se revoga `EXECUTE` ou troca para `SECURITY INVOKER`.
- `creatives.image_url` guarda signed URL com expiração (7d); a referência durável é
  `storage_bucket` + `storage_path`. Quem precisar de URL viva deve re-assinar.
