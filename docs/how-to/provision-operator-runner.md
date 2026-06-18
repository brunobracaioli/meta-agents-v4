# How-to: provisionar um runner por operador

> Diátaxis · how-to · escopo: Fase 4 da feature multi-operador (ADR 0027 / SPEC-017).
> Pré-requisitos: `flyctl` instalado e autenticado (`fly auth login`); `.env.local` com
> `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`; o operador já existe em
> `public.operators` (criado pelo trigger no signup do Supabase Auth).

Cada operador roda **um app Fly dedicado** que claima **apenas os próprios jobs**. O que
isola um runner ao operador é a env var **`OPERATOR_ID`** + a credencial Claude/connectors
do operador no volume — ver ADR 0027.

## 1. Provisionar o app, volume e secrets

```bash
# <operator-uuid> = operators.id (== auth.users.id) que este runner serve
scripts/provision-operator-runner.sh <operator-uuid>
```

O script (idempotente):

1. cria o app `meta-agents-op-<8hex-do-uuid>` (região `gru`);
2. cria o volume `claude_state` (montado em `/home/runner/.claude`);
3. seta os secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY` e **`OPERATOR_ID`**
   (lendo do `.env.local`, com strip de `\r`/aspas — gotcha de sync do Fly);
4. faz `fly deploy` da mesma imagem (`Dockerfile`), sobrescrevendo o nome do app;
5. grava `operators.fly_app_name` + `runner_status='provisioned'`.

> Variáveis opcionais: `ENV_FILE` (default `./.env.local`), `FLY_ORG` (default `personal`),
> `FLY_REGION` (default `gru`).

## 2. Seedar a credencial Claude + connectors (manual, 1x)

A credencial Claude (OAuth) e os connectors **Meta Ads / Google Ads** vivem na conta
**claude.ai do operador** e são materializados no volume — nunca em secrets/env. Por isso é um
passo interativo único:

```bash
fly ssh console -a meta-agents-op-<suffix> -C claude   # completa o login OAuth
```

Depois, na conta claude.ai **do próprio operador**, conecte os connectors personalizados em
<https://claude.ai/customize/connectors> (Meta Ads e Google Ads). Enquanto a credencial não
estiver seedada, `run-skill.sh` sai com código 3 (`Claude OAuth not seeded`) e nenhum job roda.

Quando validado, marque o operador como pronto:

```sql
update public.operators
   set runner_status = 'ready',
       connectors_status = '{"meta": true, "google": true}'::jsonb
 where id = '<operator-uuid>';
```

## 3. Verificar

```bash
fly logs -a meta-agents-op-<suffix>      # POLL ... claimed job=... / "no pending jobs"
```

- O runner claima **só** jobs com `agent_jobs.operator_id = <operator-uuid>` (RPC 2-arg).
- `run-skill.sh` **recusa** (exit 3) um job cujo cliente não pertença ao operador — 3ª barreira
  do threat model (`docs/security/threats/multi-operator.md`).
- O runner legado `meta-agents-v4` (sem `OPERATOR_ID`) continua no claim 1-arg, **inalterado**.

## Notas / pendências

- **Backward-compat:** os scripts do runner só entram no caminho escopado quando `OPERATOR_ID`
  está setado. Sem ele, o comportamento é idêntico ao single-tenant atual.
- **Migration `20260618000006_scoped_claim_autonomous_watch.sql`** (overload 2-arg de
  `claim_autonomous_watch`) precisa ser **aplicada** antes de um runner por operador rodar o
  poller de autonomous-watches. É aditiva (mantém o 1-arg); aplique junto desta validação.
- **Workspace por cliente** (`/app/clients/<slug>/.claude`) é a Fase 5. Até existir, `run-skill.sh`
  cai no `/app/.claude` baked (skills `-<slug>` hardcoded de hoje).
- **Drop do `claim_agent_job(text)` 1-arg**: só na Fase 7, depois que o runner do bruno migrar
  para 2-arg e os jobs forem backfillados com `operator_id`.
