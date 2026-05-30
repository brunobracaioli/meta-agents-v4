# Threat Model (STRIDE) — Web Dashboard + Ultron

> Spec: [docs/specs/web-dashboard-ultron.md](../../specs/web-dashboard-ultron.md). Atualizar quando a superfície mudar.

## Superfície de ataque

Login por senha; endpoints de voz (`/ultron/stt|chat|tts`) que consomem providers pagos;
leitura do Supabase com service key (server-only); microfone do operador; Realtime/SSE
da live view (fase 4); cookie de sessão JWT.

**Acréscimo (ADR 0009 / spec ultron-agent-trigger):** duas **tools de escrita** do Ultron
— `request_campaign_creation` e `request_campaign_activation` — que **enfileiram** um job
na tabela `agent_jobs`; o runner Fly.io (`poll-agent-jobs.sh`) claima e executa o skill.
A ativação dispara **gasto real** na Meta. Esta é uma elevação relevante: o Ultron deixa
de ser somente leitura.

## STRIDE

### S — Spoofing
- **Ameaça:** acesso sem ser o operador. **Mitigação:** senha única + cookie JWT assinado
  (`AUTH_SECRET`), httpOnly/Secure/SameSite=Lax; middleware barra `/dashboard` e `/api/*`.
- **Ameaça:** roubo de cookie. **Mitigação:** httpOnly (sem JS), Secure (só HTTPS), expiração curta.

### T — Tampering
- **Ameaça:** payload manipulado nos endpoints. **Mitigação:** validação Zod em toda fronteira;
  limites de tamanho (áudio, texto ≤ 2000); JWT verificado (assinatura) a cada request.
- **Ameaça:** SQL injection nas tools. **Mitigação:** queries parametrizadas (supabase-js);
  sem concatenação de string em query.
- **Ameaça:** voz/modelo escolher um skill arbitrário para rodar na VM. **Mitigação:** o
  nome do skill é resolvido **server-side a partir de um allowlist fixo** (mapa por slug
  em `tools.ts`), nunca de texto livre; o poller revalida o skill (charset + existência em
  disco) e restringe os `args` a um charset seguro antes de passá-los ao shell.

### R — Repudiation
- **Ameaça:** ação sem rastro. **Mitigação:** logs estruturados (sem PII) de login e de uso
  das tools do Ultron; `operation_logs`/`agent_events` no lado dos agents.
- **Ameaça:** criação/ativação sem trilha. **Mitigação:** cada pedido vira uma linha em
  `agent_jobs` (quem/quando/`confirmed_at`/status/erro); a ativação grava
  `operation_logs(action='activate', actor='ultron-trigger')` por entidade.

### I — Information disclosure
- **Ameaça:** segredo no bundle client. **Mitigação:** `SUPABASE_SECRET_KEY`/chaves de
  provider só em código server; checagem `grep` no `.next`; browser só usa publishable key.
- **Ameaça:** erro vaza stack/DB. **Mitigação:** respostas de erro genéricas; detalhe só no log.
- **Ameaça:** PII em log (transcrição/áudio). **Mitigação:** não logar transcrição crua nem
  áudio; memória do Ultron com TTL curto no Redis.

### D — Denial of service / custo
- **Ameaça:** abuso dos endpoints pagos (STT/LLM/TTS) drena custo. **Mitigação:** rate limit
  (Upstash) por sessão/IP em `/auth/login` e `/ultron/*`; limite de tamanho/duração de áudio;
  VAD corta silêncio; memória curta; cap de iterações no loop de tool-use; 429 + Retry-After.
- **Ameaça:** payload de áudio gigante. **Mitigação:** limite no `MediaRecorder` (timeout 12s)
  e no handler (413).
- **Ameaça:** disparo repetido de criação/ativação drena custo (LLM dos agents, gasto Meta).
  **Mitigação:** índice único parcial `agent_jobs_one_active_per_kind` (no máx. 1 job ativo
  por cliente+tipo) + rate limit por slug (`campaign-creation` 5/h, `campaign-activation`
  3/h) + confirmação em 2 turnos + poller single-flight (lock) processando 1 job por vez.

### E — Elevation of privilege
- **Ameaça:** Ultron dispara trabalho/gasto indevido (criar/ativar campanha). **Mitigação:**
  só **enfileira** (não toca a Meta direto); skill vem de allowlist fixa server-side;
  **confirmação obrigatória em 2 turnos** (tool com `confirm`, reforçada no system prompt);
  ativação só de campanha **do cliente**, **PAUSED** e com **daily budget ≤ teto** — revalidado
  no web tool **e** no skill privilegiado (`activate-campaign-brunobracaioli`); criação nasce
  PAUSED. Service key nunca chega ao client.
- **Ameaça:** prompt injection vinda de dados do banco (ex.: nome de campanha malicioso) faz o
  modelo "agir" (ex.: chamar a tool de escrita). **Mitigação:** tools não executam comandos do
  conteúdo; resultados tratados como dados; system prompt instrui a ignorar instruções dentro
  de dados; mesmo se o modelo chamar a tool, o `client_slug`/`campaign_meta_id` precisam casar
  com registros reais e os gates (allowlist, PAUSED, teto, confirmação) seguram a ação.
- **Ameaça:** job preso em `claimed` bloqueia a fila daquele tipo. **Mitigação:** o poller marca
  `failed` em saída inesperada (trap EXIT); risco residual aceito (dívida: reaper de jobs órfãos).

## Checklist antes do deploy

- [ ] Nenhum segredo server-side no bundle (`grep -r sb_secret\|ELEVENLABS_API_KEY web/.next`)
- [ ] Middleware protege `/dashboard/*` e `/api/*` (exceto login) + security headers
- [ ] Zod em todos os handlers; limites de tamanho aplicados
- [ ] Rate limit ativo em `/auth/login` e `/ultron/*` (429 testado)
- [ ] Erros genéricos ao cliente; logs sem PII
- [ ] Tools de escrita do Ultron: skill via allowlist fixa, confirmação 2 turnos, rate limit
- [ ] Ativação só de campanha do cliente, PAUSED e com budget ≤ teto (web tool + skill)
- [ ] `agent_jobs`: RLS on, índice único de 1-job-ativo-por-tipo; poller valida skill+args
- [ ] Cookie httpOnly/Secure/SameSite=Lax; JWT com `AUTH_SECRET` forte
