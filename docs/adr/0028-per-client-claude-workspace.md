# ADR 0028 — Workspace `.claude` completo por cliente, materializado de um template

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-18 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/SPEC-017-multi-operator-multitenant.md](../specs/SPEC-017-multi-operator-multitenant.md) |
| Relacionado | [ADR 0027](0027-runner-per-operator.md), [ADR 0014](0014-product-catalog-as-repo-files.md) (materiais como arquivos) |

## Context

Hoje as 8 skills de negócio têm o cliente **hardcoded no nome**
(`create-traffic-brunobracaioli-campaign`, …) e há um único `.claude/` no projeto. Para N
clientes precisamos de uma estratégia: (a) skills genéricas parametrizadas por `client_slug`,
(b) híbrido base compartilhada + override por cliente, ou (c) **`.claude` completo por cliente**.

O operador escolheu **(c)**: cada cliente com sua árvore
`clients/<slug>/.claude/{skills,hooks,agents,settings.json}` + materiais — isolamento físico
máximo e liberdade de divergir por cliente. O risco óbvio de (c) é **drift**: corrigir um bug
viraria N edições manuais.

## Decision

**Cada cliente tem um workspace `.claude` completo, mas materializado de um template — a
fonte única de verdade.** Não se edita N cópias à mão.

- **Template** em `templates/client-claude/` (skills genéricas + hooks + agents + `settings.json`).
- **`scripts/scaffold-client-workspace.sh <slug>`** materializa `clients/<slug>/.claude/...`
  + materiais (`materiais-das-empresas/<slug>/`). **Idempotente**: re-rodar propaga updates do
  template para o cliente sem apagar customizações registradas.
- **Constantes do cliente** (ad_account, BM, page, budget, URLs) **não** são hardcoded no
  workspace: resolvidas em runtime via `SELECT ... FROM clients WHERE slug=<slug>` — fonte
  única no banco (igual ao padrão atual das skills).
- No runner, o `run-skill.sh` faz `cd /app/clients/<slug>` antes do `claude -p`, então o
  Claude Code carrega o `.claude` daquele cliente (nível projeto) sobre a credencial do
  operador (nível HOME — ADR 0027).

### Alternativas consideradas

- **Skills genéricas puras (1 cópia, `client_slug` em args)** — máximo DRY, zero drift, mas
  sem isolamento físico nem customização por cliente. Não escolhido pelo operador.
- **Híbrido base (`~/.claude`) + override por cliente** — DRY com customização, mas mistura
  dois níveis de skill e é menos previsível. Não escolhido.

## Consequences

**Positivas:** isolamento total por cliente; um cliente pode divergir (skill/setting próprios)
sem afetar os outros; o gerador a partir do template **neutraliza o drift** (a manutenção é no
template + re-scaffold).

**Negativas / dívidas:** mais disco e mais arquivos por cliente; um update de template só chega
ao cliente quando o `scaffold` roda de novo (precisa de disciplina/CI para re-materializar);
customizações por cliente precisam ser registradas de forma que o re-scaffold não as sobrescreva
(estratégia de merge a definir na Fase 5). As skills legadas `-brunobracaioli` ficam até o cutover.
