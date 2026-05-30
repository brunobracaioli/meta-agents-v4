# Threat Model (STRIDE) — Web Dashboard + Ultron

> Spec: [docs/specs/web-dashboard-ultron.md](../../specs/web-dashboard-ultron.md). Atualizar quando a superfície mudar.

## Superfície de ataque

Login por senha; endpoints de voz (`/ultron/stt|chat|tts`) que consomem providers pagos;
leitura do Supabase com service key (server-only); microfone do operador; Realtime/SSE
da live view (fase 4); cookie de sessão JWT.

## STRIDE

### S — Spoofing
- **Ameaça:** acesso sem ser o operador. **Mitigação:** senha única + cookie JWT assinado
  (`AUTH_SECRET`), httpOnly/Secure/SameSite=Lax; middleware barra `/dashboard` e `/api/*`.
- **Ameaça:** roubo de cookie. **Mitigação:** httpOnly (sem JS), Secure (só HTTPS), expiração curta.

### T — Tampering
- **Ameaça:** payload manipulado nos endpoints. **Mitigação:** validação Zod em toda fronteira;
  limites de tamanho (áudio, texto ≤ 2000); JWT verificado (assinatura) a cada request.
- **Ameaça:** SQL injection nas tools. **Mitigação:** SQL parametrizado/Drizzle; tools são
  read-only e parametrizadas; sem concatenação de string em query.

### R — Repudiation
- **Ameaça:** ação sem rastro. **Mitigação:** logs estruturados (sem PII) de login e de uso
  das tools do Ultron; `operation_logs`/`agent_events` no lado dos agents.

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

### E — Elevation of privilege
- **Ameaça:** Ultron muta dados via tool. **Mitigação:** tools exclusivamente read-only; o app
  não expõe nenhuma rota de escrita no Meta/Supabase. Service key nunca chega ao client.
- **Ameaça:** prompt injection vinda de dados do banco (ex.: nome de campanha malicioso) faz o
  modelo "agir". **Mitigação:** tools não executam comandos do conteúdo; resultados tratados como
  dados; system prompt instrui a ignorar instruções dentro de dados; nenhuma tool de escrita existe.

## Checklist antes do deploy

- [ ] Nenhum segredo server-side no bundle (`grep -r sb_secret\|ELEVENLABS_API_KEY web/.next`)
- [ ] Middleware protege `/dashboard/*` e `/api/*` (exceto login) + security headers
- [ ] Zod em todos os handlers; limites de tamanho aplicados
- [ ] Rate limit ativo em `/auth/login` e `/ultron/*` (429 testado)
- [ ] Erros genéricos ao cliente; logs sem PII
- [ ] Tools do Ultron read-only; sem rota de escrita
- [ ] Cookie httpOnly/Secure/SameSite=Lax; JWT com `AUTH_SECRET` forte
