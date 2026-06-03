# ADR 0016 — Tabela `products` como read-model da hierarquia (brief em arquivo segue fonte de geração)

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-03 |
| Decidido por | brunobracaioli |
| Spec | [SPEC-012](../specs/SPEC-012-landing-page-editor.md) |
| Relacionado | [ADR 0014](0014-product-catalog-as-repo-files.md) (catálogo em arquivo), [ADR 0015](0015-editable-landing-pages-supabase-draft.md) |
| Afeta | `products` (migration 20260603000001), `landing_pages.product_id`, `web/` dashboard |

## Context

A SPEC-012 exige a hierarquia **cliente → produto → landing page** no banco: o dashboard
lista produtos por cliente e roteia `/dashboard/clients/<slug>/<produto>/landing-page/<id>`,
e uma LP referencia o produto a que pertence. Hoje (ADR 0014) o catálogo de produtos é
**file-based** (`.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`), porque a
skill de geração roda **headless** no Fly e ali o **MCP do Supabase é OAuth-gated** — o
brief precisa ser lido via `Read`, sem rede.

Tensão: o dashboard (Vercel) precisa da hierarquia **no banco** para listar/rotear; a
geração (Fly headless) precisa do brief **em arquivo**. As duas exigências não se anulam.

## Decision

**Adicionar uma tabela `products` como read-model do catálogo; o arquivo segue a fonte de
verdade do brief de geração (ADR 0014 mantida, não revogada).**

- `products(client_id, slug, name, brief_path, brief jsonb, default_subdomain, status)`.
  - `brief_path` aponta para o arquivo canônico em disco (lido pela skill headless).
  - `brief` é um **snapshot** do arquivo, gravado/atualizado pela skill de geração no
    momento em que cria/atualiza a LP (a skill já lê o arquivo; faz o upsert de passagem).
  - O dashboard só precisa de `id/slug/name` para listar e rotear.
- `landing_pages.product_id → products(id)` materializa cliente → produto → LP.

## Consequences

- ✅ Dashboard tem a hierarquia em SQL (join simples), sem ler arquivos do repo no Vercel.
- ✅ Geração headless continua lendo o brief por `Read` (ADR 0014 intacta) — sem depender
  do MCP do Supabase.
- ✅ `brief` (snapshot) permite ao dashboard mostrar contexto do produto sem acessar disco.
- ⚠️ Duplicação arquivo × `brief` snapshot: o arquivo é a fonte; o snapshot pode ficar
  defasado se o arquivo mudar sem rerodar a skill. Aceitável — o snapshot é read-model de
  exibição, não fonte de geração. Reconciliação acontece no próximo create/update da LP.
- ⚠️ Novo produto exige uma linha em `products` (a skill faz o upsert; sem skill, um seed
  manual). Documentado na skill de geração (Wave 3).
