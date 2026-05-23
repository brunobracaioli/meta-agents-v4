# Headless command cookbook

> Como invocar Claude Code em modo não-interativo (`-p`) para as skills deste projeto.

## Por que isso importa

As skills `create-traffic-<nome-cliente>-campaign` e `edicao-de-campanha-nome-do-cliente` são projetadas pra rodar autônomas (cron, queue worker, comando one-shot). Mas o modo `-p` tem 3 armadilhas:

1. **`AskUserQuestion` trava a sessão** — sem humano pra responder, o agente fica em deadlock. Mitigação: as skills foram reescritas para nunca chamar `AskUserQuestion`. Se você usar OUTRA skill em headless, verifique o markdown dela.
2. **Auto-mode classifier bloqueia writes** — mesmo com `permissions.allow` configurado, o classifier de risco do Claude Code pode negar chamadas em conta de cliente. Mitigação: ou use `--dangerously-skip-permissions`, ou garanta que TODAS as tools usadas estão na allowlist (foi o que `settings.json` faz agora — atenção ao prefixo correto `mcp__claude_ai_Meta_Ads_MCP__*`).
3. **Sub-agentes herdam permission mode** — se a skill spawna subagent, ele roda no mesmo mode. OK na prática.

## Comandos

### Criar campanha (cliente <nome-cliente>, produto Claude Code Architect)

```bash
claude --dangerously-skip-permissions -p "execute a skill /create-traffic-<nome-cliente>-campaign para gerar uma nova campanha de tráfego hoje"
```

`--permission-mode bypassPermissions` NÃO é suficiente para writes em conta de cliente — o classifier de risco ainda bloqueia. Use `--dangerously-skip-permissions` para headless real.

Saída esperada:
- 3 PNGs em `.claude/materiais-das-empresas/<nome-cliente>/generated-ads/cca-YYYY-MM-DD/`
- Campanha + adset + 3 ads PAUSED na conta Meta `225179730538661`
- Manifest JSON em `tentativas-geracao-de-campanhas/YYYYMMDD-HHMM-trafego.json`

### Editar campanha

```bash
claude --dangerously-skip-permissions -p "execute a skill /edicao-de-campanha-nome-do-cliente: aumente o orçamento da campanha 120245567804800505 em 25%"
```

Outros exemplos de pedido (em linguagem natural — a skill faz parse):
- `"pause o ad 120245567813770505"`
- `"ative a campanha 120245567804800505"` (ativa, mas só por pedido explícito)
- `"troque o nome da campanha 120245567804800505 para 'CCA — Wave 1'"`

### Verificar status (read-only — sem flag dangerous)

```bash
claude -p "liste as campanhas ativas na conta 225179730538661 via Meta Ads MCP"
```

## Quando usar cada flag

| Flag | O que pula | Headless serve pra writes em conta de cliente? |
|---|---|---|
| `-p` (sozinho) | Nada — prompts ficam pendentes e a sessão morre | ❌ |
| `--permission-mode bypassPermissions -p` | Prompts de permissão | ❌ — classifier ainda bloqueia |
| `--dangerously-skip-permissions -p` | Prompts E classifier | ✅ — é o que resolve |

Trade-off de `--dangerously-skip-permissions`: a flag desliga TODAS as proteções. Você está confiando no markdown da skill como contrato. Por isso as duas skills do projeto têm "limites duros" embutidos (R$ 50/dia max, tudo PAUSED, etc.) — defesa em profundidade no nível da instrução.

## Cron / agendamento

Pra rodar via cron do sistema (não via `/loop` ou Vercel Cron):

```cron
# Toda segunda às 10h: criar campanha nova
0 10 * * 1 cd /mnt/c/agents_team_meta_ads_v3 && /usr/bin/claude --dangerously-skip-permissions -p "execute a skill /create-traffic-<nome-cliente>-campaign" >> /var/log/cca-cron.log 2>&1
```

## Debug quando der ruim

1. Cheque o manifest em `tentativas-geracao-de-campanhas/`. Se não existe, o agente parou antes do passo final.
2. Cheque `effective_status` no Ads Manager. Entidades parciais com `WITH_ISSUES` indicam o que faltou.
3. Rode interativo (`claude` sem `-p`) com o mesmo prompt — o agente vai pedir confirmação onde travaria em headless. Use pra reproduzir.
4. `ads_get_errors` no Meta MCP retorna erros recentes de criação na conta.

## Pré-requisitos da máquina

- `/mnt/c/agents_team_meta_ads_v3/.env.local` com `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Meta Ads MCP autenticado (já feito — token persistido no client)
- Supabase MCP autenticado
- Bucket `generated-images` no Supabase (público) — já existe
- Pasta `tentativas-geracao-de-campanhas/` na raiz do projeto (criada se faltar)
