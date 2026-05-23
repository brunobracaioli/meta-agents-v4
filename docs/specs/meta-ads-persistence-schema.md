# Spec — Persistência da agência Meta Ads (Supabase Postgres)

> Status: implementado em 2026-05-23. ADR: [0002](../adr/0002-supabase-meta-ads-persistence-schema.md).

## Objetivo

Persistir, de forma reconciliável e auditável, tudo que os agentes criam/editam no
Meta Ads (campanhas, conjuntos, anúncios, criativos) e os assets gerados (imagens
gpt-image-2 + copy), conforme exigido pelo CLAUDE.md.

## Modelo de dados

Hierarquia espelhando o Meta:

```
clients ──< campaigns ──< ad_sets ──< ads >── creatives >── generated_images
   └────────────────────────────────────────────────< operation_logs
```

### Tabelas

| Tabela | Papel | Chave natural (unique) |
|---|---|---|
| `clients` | infoprodutor / conta gerenciada | `slug`, `ad_account_id` |
| `campaigns` | campanha Meta | `meta_campaign_id` |
| `ad_sets` | conjunto Meta | `meta_ad_set_id` |
| `ads` | anúncio Meta | `meta_ad_id` |
| `creatives` | criativo (copy + CTA + link + imagem) | `meta_creative_id` |
| `generated_images` | asset gpt-image-2 no Storage | `(storage_bucket, storage_path)` |
| `operation_logs` | auditoria create/update/delete/activate/pause | — |

### Contratos / invariantes

- Todo valor monetário em `*_cents` (integer, > 0).
- IDs externos do Meta em `text`.
- `budget_mode ∈ {CBO, ABO}`; em CBO o budget vive em `campaigns.daily_budget_cents`
  e `ad_sets.daily_budget_cents` é NULL.
- `ad_sets.advantage_audience` / `advantage_placements` registram o uso de Advantage+.
- `operation_logs.entity_type ∈ {client,campaign,ad_set,ad,creative,image}`,
  `action ∈ {create,update,delete,activate,pause}`.
- Upsert sempre por chave natural (`ON CONFLICT ... DO UPDATE`) para idempotência.

## Segurança

- RLS habilitado em todas as tabelas, **deny-by-default** (sem policy).
- Acesso de escrita/leitura do agente: `service_role` (bypassa RLS).
- `anon`/`authenticated`: sem acesso até o app definir policies por tenant/usuário.
- `set_updated_at()` com `search_path` pinado.

## Estado inicial populado (2026-05-23)

Campanha CCA do cliente `brunobracaioli`:

- 1 client, 1 campaign (`120246500174380505`, CBO R$50/dia, PAUSED),
  1 ad_set (`120246500175190505`, US, Advantage+), 3 creatives, 3 generated_images,
  3 ads, e operation_logs de create.

## Pendências / próximos passos

- Definir RLS policies quando houver app com Supabase Auth (multi-tenant por cliente).
- Decidir o destino da função `rls_auto_enable` (advisors 0028/0029).
- Gerar tipos via `generate_typescript_types` para o backend Drizzle.
