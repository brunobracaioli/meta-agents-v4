# ADR 0014 — Catálogo de produtos como arquivos no repo (não tabela Supabase)

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-06-02 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/SPEC-011-landing-page-generation.md](../specs/SPEC-011-landing-page-generation.md) |
| Relacionado | [ADR 0012](0012-landing-pages-on-cloudflare-pages.md) (hosting), [ADR 0013](0013-landing-page-design-system.md) (design system), [ADR 0009](0009-on-demand-agent-jobs-queue.md) (fila/runner headless) |
| Afeta | `.claude/skills/lista-de-produtos/`, `.claude/materiais-das-empresas/<cliente>/produtos/`, `.claude/skills/create-landing-page-brunobracaioli/`, `.claude/agents/landing-page-architect.md`, `.claude/agents/lp-copywriter.md` |

## Context

A skill de geração de LP hardcodava um único produto ("Claude Code Architect", `149700`,
checkout Hubla do CCA) inline e nos objetos `product` dos subagents. Para gerar LPs de
**outros produtos** (ex.: a "Imersão AgêncIA Tráfego Pago") sem reescrever a skill, é preciso
uma fonte estruturada de brief de produto por cliente (dores, mecanismo, oferta, autoridade,
números, agenda) que a skill consulte.

Restrição decisiva: a skill roda **headless** no runner Fly (`claude -p`), e ali o **MCP do
Supabase é OAuth-gated — não autentica headless** (memória do projeto; o runner usa REST/curl
com `SUPABASE_SECRET_KEY` só para `agent_jobs`/`agent_events`). Logo, um catálogo que a skill
precisa **ler no momento da geração** não pode depender do MCP. As opções eram: (a) arquivo no
repo lido via `Read`; (b) tabela Supabase lida via REST/curl embutido na skill; (c) tabela só
via MCP (inviável headless).

O `.claude/` inteiro já é `COPY`-ado para a imagem Fly (`COPY .claude /app/.claude`), então
arquivos sob `.claude/` estão disponíveis para `Read` em qualquer run headless, sem rede.

## Decision

**O catálogo de produtos é file-based, versionado no repo, e é a fonte da verdade do brief.**

- **Briefs JSON**: `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json` — um arquivo
  por produto, co-localizado com os assets de marca do cliente. Shape rico: identidade,
  `offer` (priceCents, anchorPriceCents, checkoutUrl, waitlistUrl, cartState, deadline,
  payments, guarantee, scarcity), conteúdo de copy (dores, mecanismo, stack, prereqs, agenda,
  entregaveis, persona, comparison, autoridade, numeros, faqHints), `seo`, `assets`, `brand`.
- **Skill índice** `lista-de-produtos` (espelha `lista-de-clientes`): tabela markdown listando
  produtos por cliente (slug, preço, checkout, subdomínio padrão, path do brief).
- A skill `create-landing-page-brunobracaioli` recebe `product=<slug>` (default `cca`), lê o
  brief via `Read` e o passa aos subagents `landing-page-architect` + `lp-copywriter`, que
  **escrevem a partir dele** (não inventam). O `scrape` de `ref-url` vira opcional/suplementar.

**Sem tabela Supabase `products` por enquanto.** A persistência transacional (a LP gerada)
continua em `landing_pages`; o catálogo de produtos é reference data file-based.

## Consequences

**Positivas**
- Leitura headless trivial e offline-safe (`Read`, zero MCP/rede) — robusto no runner Fly.
- Versionado e auditável (git); review por PR; mesma pattern do `lista-de-clientes`.
- Brief rico → copy fundamentada em dados reais (menos alucinação), alimentando as seções
  novas do design system (comparison, stats, persona, authority, guarantee, urgency).
- Multi-produto por cliente sem reescrever a skill (`product=<slug>`).

**Negativas / trade-offs**
- Não é queryável por SQL/dashboard (o Ultron não "lista produtos" via DB ainda). Se isso for
  necessário, um ADR futuro adiciona uma tabela `products` **espelhada** a partir dos arquivos
  (arquivo continua source of truth; tabela é índice).
- Edição é via arquivo/PR, não via UI.
- O `checkoutUrl` (link público de pagamento) fica versionado — aceitável; **nunca** versionar
  chave de API de gateway, só o link público de checkout.

## Alternatives rejected

- **Tabela Supabase `products` como fonte única** — leitura headless exigiria embutir REST/curl
  + `SUPABASE_SECRET_KEY` no skill (MCP não funciona headless), mais frágil e divergente do
  padrão `lista-de-clientes`. Preterida.
- **Catálogo em markdown prose** (como `lista-de-clientes`) — difícil de parsear de forma
  confiável para o objeto `product` estruturado dos subagents. JSON é melhor para consumo de máquina.
- **Manter hardcoded na skill** — não escala para múltiplos produtos; foi exatamente o problema.
