# `templates/client-claude/` — template de workspace por cliente

Fonte da verdade do `.claude/` **genérico** de um workspace por cliente (ADR 0028 / SPEC-017,
Fase 5). O script `scripts/scaffold-client-workspace.sh <slug>` materializa
`clients/<slug>/.claude/` a partir daqui + de partes específicas do cliente.

## O que vive AQUI (genérico, copiado para cada workspace)

- `settings.json` — permissions + hooks (usa `${CLAUDE_PROJECT_DIR}`, funciona em qualquer cwd).
- `agents/*.md` — os subagents (copywriter, landing-page-architect, scrape-extractor, …). Genéricos.
- `hooks/emit-agent-event.py` — telemetria → `agent_events`. Genérico (lê `SUPABASE_*` do env).
- `hooks/enforce-research-allowlist.py` — gate de WebFetch/WebSearch. Genérico.
- `hooks/remind-update-project-memory.py` — **versão parametrizada**: o rótulo do cliente vem de
  `CLIENT_LABEL` (env) ou do `client.json` do workspace; fallback genérico. (≠ do hook em
  `.claude/hooks/`, que ainda é brunobracaioli-específico — ver "Débito" abaixo.)
- `research-allowlist.txt` — domínios liberados para pesquisa.
- `skills/{autonomous-watch-tick,commit,image-generate}/` — skills genéricas (sem slug).
- `client.json.tmpl` — constantes do cliente, com tokens `{{...}}` resolvidos do DB pelo scaffold.

## O que NÃO vive aqui (específico do cliente, montado pelo scaffold)

- **Skills operacionais** (`create-traffic-<slug>-campaign`, `publish-landing-page-<slug>`, …):
  hoje têm slug + marca embutidos. O scaffold as **symlinka** de `.claude/skills/` (sem cópia →
  sem drift). Um cliente novo precisa autorar as suas (genericizá-las é trabalho futuro).
- **Registries** `lista-de-clientes` / `lista-de-produtos`: project-global → symlinkadas.
- **Materiais** (`materiais-das-empresas/<slug>/`: logo, refs-canonicas, produtos, hero, mascote):
  específicos do cliente → symlinkados do canônico.
- **`client.json`** renderizado: gerado do `.tmpl` com os valores da tabela `clients`.

## Como usar

```bash
scripts/scaffold-client-workspace.sh <slug>     # gera/atualiza clients/<slug>/.claude/ (idempotente)
```

Ver `docs/how-to/scaffold-client-workspace.md` para o passo a passo + o que falta para um cliente novo.

## Débito consciente (até a Fase 7)

Os arquivos genéricos estão **duplicados** entre `.claude/` (live, baked na imagem do runner) e
este template. Convergem quando o `brunobracaioli` migrar para um workspace scaffoldado
(`clients/brunobracaioli/`) na Fase 7. Até lá, mudanças em settings/agents/hooks genéricos devem
ser refletidas nos dois lugares.
