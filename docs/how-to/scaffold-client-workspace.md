# How-to: gerar o workspace `.claude` de um cliente

> Diátaxis · how-to · escopo: Fase 5 da feature multi-operador (ADR 0028 / SPEC-017).
> Pré-requisitos: `.env.local` com `SUPABASE_URL` + `SUPABASE_SECRET_KEY`; `jq`; o cliente já
> existe na tabela `clients` (slug + constantes de negócio).

Cada cliente tem um workspace `clients/<slug>/.claude/` montado de um **template único**
(`templates/client-claude/`) + das partes específicas do cliente. O `run-skill.sh` (Fase 4) usa
esse workspace automaticamente quando o runner tem `OPERATOR_ID` setado e o diretório existe.

## Gerar / atualizar

```bash
scripts/scaffold-client-workspace.sh <slug>     # ex.: brunobracaioli
```

Idempotente — re-rodar atualiza o esqueleto a partir do template e refaz os symlinks.

### O que o scaffold faz

| Parte | Como | Fonte da verdade |
|---|---|---|
| settings.json, agents/, hooks/, research-allowlist, skills genéricas | **copia** do template | `templates/client-claude/` |
| `client.json` (slug, ad_account, BM, page, budget, currency, …) | **renderiza** do `.tmpl` com os valores do DB | tabela `clients` |
| skills operacionais (`*-<slug>*`) + `lista-de-clientes`/`lista-de-produtos` | **symlink** | `.claude/skills/` |
| materiais (`materiais-das-empresas/<slug>/`) | **symlink** | `.claude/materiais-das-empresas/<slug>/` |

> Copia o genérico (uma fonte), symlinka o específico (sem segunda cópia → sem drift). O output
> `clients/<slug>/` é **gitignored**.

## Cliente NOVO — o que falta autorar

O scaffold monta a estrutura, mas um cliente novo ainda precisa:

1. **Seed na tabela `clients`** (slug, name, ad_account_id, business_manager_id, facebook_page_id,
   default_landing_url, daily_budget_cap_cents, currency, materials_path).
2. **Materiais** em `.claude/materiais-das-empresas/<slug>/` (logo, `refs-canonicas/`, `produtos/`,
   hero, mascote) — senão o scaffold avisa "no materials".
3. **Skills operacionais** do cliente em `.claude/skills/` (hoje têm slug + marca embutidos; copie
   de `*-brunobracaioli*` e ajuste, OU aguarde a genericização — trabalho futuro). Sem nenhuma
   skill `*-<slug>*`, o scaffold avisa "no operational skills".

## Verificar

```bash
scripts/scaffold-client-workspace.sh brunobracaioli
find clients/brunobracaioli/.claude -maxdepth 2
jq . clients/brunobracaioli/.claude/client.json
git status --porcelain clients/    # deve sair VAZIO (gitignored)
```

## Notas

- **Débito (até Fase 7):** os arquivos genéricos estão duplicados entre `.claude/` (live, baked) e
  `templates/client-claude/`. Convergem quando o bruno migrar para `clients/brunobracaioli/`.
- **Wiring no runner:** rodar o scaffold no build da imagem / no provisionamento (ADR 0027) é passo
  da Fase 7 — não está no `Dockerfile` ainda. Ver `docs/how-to/provision-operator-runner.md`.
