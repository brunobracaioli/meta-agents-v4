# ADR 0001 — Fly Machine always-on com supercronic interno para o runner de campanhas

| Campo | Valor |
|---|---|
| Status | Accepted |
| Data | 2026-05-19 |
| Decidido por | brunobracaioli |
| Spec | [docs/specs/flyio-cron-campaign-runner.md](../specs/flyio-cron-campaign-runner.md) |

## Context

Precisamos executar, 1x/dia, o comando

```bash
claude -p --dangerously-skip-permissions ".claude/skills/create-traffic-brunobracaioli-campaign"
```

sem operador humano no loop. O comando depende não só de uma `ANTHROPIC_API_KEY`, mas do **estado da conta Claude.ai do operador no Claude Code CLI** — em particular dos **connectors Claude.ai** (Meta Ads MCP, Supabase MCP) que **só ficam autenticados após um `claude login` interativo**. Esse estado vive em `~/.claude/`.

Avaliei três padrões (todos documentados em `docs/FLYIO_REFERENCE.md` e no plano de fundo):

1. **GitHub Actions agendado** que chama `fly machine run <image>`: cria Machine efêmera, executa, destrói. Mais barato em runs raros.
2. **Vercel Cron** chamando um endpoint HTTP no Fly: requer expor porta + autenticação de webhook.
3. **Fly Machine always-on** com supercronic interno + volume persistente.

## Decision

Escolhemos **(3) Fly Machine always-on em `gru` com supercronic interno + volume `claude_state` montado em `/home/runner/.claude`**, seedado uma vez via `fly ssh console` → `claude` (OAuth interativo).

### Por que não (1) GitHub Actions + machine efêmera

Cada Machine efêmera começa do zero. Sem volume montado, sem `~/.claude/`. Teríamos que ou (a) injetar os tokens OAuth como secret do GitHub e recriar `.credentials.json` a cada run — frágil, OAuth do Claude Code rotaciona — ou (b) montar o volume em uma Machine "spawn-and-mount", o que joga fora a economia do modelo efêmero. **A simplicidade do "tudo num lugar" supera os $5/mês economizados.**

### Por que não (2) Vercel Cron → HTTP no Fly

Adiciona superfície de ataque (porta exposta, webhook a autenticar) sem benefício real: a Fly Machine já está rodando para hospedar Claude Code; basta supercronic interno. **Menos peças móveis = menos coisas a quebrar às 3 da manhã.**

## Consequences

### Positivas

- Tudo em um lugar: deploy, cron, logs, estado.
- Connectors da Claude.ai (Meta MCP em particular) funcionam exatamente como funcionam no Claude Code do desktop do operador — paridade dev/prod.
- Operação simples: `fly ssh console` resolve quase qualquer incidente.
- `fly logs` retém ~30d e captura output da skill via supercronic `-passthrough-logs`.

### Negativas

- Custo fixo ~**$6/mês** (`shared-cpu-2x` always-on + 1GB volume) mesmo em dias sem execução. Aceitável: ROI esperado da automação > 100x esse custo.
- **Seed manual via SSH** na primeira vez (e em qualquer evento de perda do volume). Não 100% automatizado, mas operação rara.
- Volume é single-region — se `gru` cair, runner para. Não temos requisito de HA na onda 1.

### Riscos rastreados

- OAuth do Claude Code expirar silenciosamente → mitigado por `healthz.sh` que falha se `.credentials.json` estiver ausente após 5min.
- `--dangerously-skip-permissions` permitindo ação destrutiva → mitigado por isolamento Firecracker, prompt 100% hardcoded (sem input externo) e skill sob revisão. Threat model detalha; revisitar quando habilitarmos prompts dinâmicos.

## When to revisit

- Quando virar **multi-cliente** (mais de 3 skills agendadas): reavaliar se vale rotear via fila ou se múltiplos crontabs no mesmo container ainda escalam.
- Quando o custo Fly passar de **$30/mês**: avaliar GitHub Actions efêmero novamente, ou consolidar em servidor próprio.
- Quando precisarmos de **HA cross-region**: este ADR fica superseded; abrir ADR 000X com novo design.
