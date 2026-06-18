# How-to: onboarding de um operador

> Diátaxis · how-to · escopo: Fase 6 da feature multi-operador (ADR 0026/0027 / SPEC-017).
> Vale só em `AUTH_MODE=supabase`. No modo `password` (atual) não há operadores.

Fluxo ponta a ponta para colocar um operador novo em produção: do cadastro até o runner
processar jobs. Cada operador usa a **própria conta Anthropic** e os **próprios connectors**
(Meta/Google) no claude.ai — a plataforma não guarda esses tokens.

## 1. Cadastro (signup)

- Habilite (temporariamente) `AUTH_ALLOW_SIGNUP=true` na Vercel, ou crie o usuário no painel do
  Supabase Auth (convite). O signup aberto é **off por default** (onboarding é invite/admin-gated).
- O operador acessa `/signup`, informa e-mail + senha (+ nome opcional). O trigger
  `handle_new_operator` cria a row em `public.operators` com `runner_status='none'`.
- Ao entrar, o **banner de onboarding** mostra o passo pendente até o runner ficar `ready`.

## 2. Vincular os clientes ao operador

Cada cliente do operador precisa de `clients.operator_id = <operator-uuid>`:

```sql
update public.clients set operator_id = '<operator-uuid>' where slug = '<client-slug>';
```

(O dashboard isola por RLS: o operador só vê os clientes que possui.)

## 3. Provisionar o runner Fly

```bash
scripts/provision-operator-runner.sh <operator-uuid>
```

Cria o app `meta-agents-op-<8hex>`, volume, secrets (inclui `OPERATOR_ID`) e faz deploy. Marca
`operators.runner_status='provisioned'`. Ver `docs/how-to/provision-operator-runner.md`.

## 4. Seedar Claude + connectors (manual, 1x)

```bash
fly ssh console -a meta-agents-op-<suffix> -C claude     # completa o login OAuth
```

Na conta **claude.ai do operador**, conectar os connectors personalizados (Meta Ads + Google Ads)
em <https://claude.ai/customize/connectors>.

## 5. (Opcional) Gerar o workspace do cliente

```bash
scripts/scaffold-client-workspace.sh <client-slug>       # ver scaffold-client-workspace.md
```

## 6. Marcar como pronto

Quando o login + connectors estiverem OK:

```sql
update public.operators
   set connectors_status = '{"claude_login": true, "meta": true, "google": true}'::jsonb,
       runner_status = 'ready'
 where id = '<operator-uuid>';
```

A partir daí o **gate de enqueue libera**: o operador pode criar/ativar campanhas, analisar e
publicar landing pages. Antes disso, qualquer enqueue retorna `runner_not_ready` (UI/Ultron).

## Notas

- **Gate de enqueue:** vive em `operatorRunnerReady()` (`web/lib/auth/current-operator.ts`); checa
  `status='active' && runner_status='ready'`. No modo `password` é sempre `true` (sem gate).
- **Reverter signup aberto:** volte `AUTH_ALLOW_SIGNUP` para `false` após onboardar.
- **bruno (operador #1):** a migração dele + flip de `AUTH_MODE=supabase` é a **Fase 7** (pós-launch);
  o cutover precisa setar `runner_status='ready'` dele senão os enqueues bloqueiam.
