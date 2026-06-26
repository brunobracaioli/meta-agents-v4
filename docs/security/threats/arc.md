# Threat model — ARC (frontend holográfico do Ultron)

| Campo | Valor |
|---|---|
| Feature | ARC / Render Bus de UIIntents ([SPEC-019](../../specs/SPEC-019-arc-holographic-ui.md), [ADR 0031](../../adr/0031-arc-holographic-render-bus.md)) |
| Data | 2026-06-26 |
| Superfície nova | rota `/dashboard/arc`, render-tools (read-only), coluna `ultron_narrations.render`, popout (BroadcastChannel), webcam (wave D) |

## Enquadramento

A ARC é majoritariamente **apresentação**. Não há rota de **escrita** nova: render-tools são read-only e
mutações continuam nas tools `request_*` existentes (já modeladas/loggadas). O risco real concentra-se em
**vazamento cross-tenant**, **DoS de UI** e **injeção de conteúdo** (iframe/popout). Sem PII em logs.

## STRIDE

### S — Spoofing
- **Risco:** acesso a `/dashboard/arc` ou a render-tools sem autenticação.
- **Mitigação:** `/dashboard/arc` herda o guard do grupo `(app)`; `/api/ultron/*` já aplica
  `getCurrentOperatorId`. Render-tools que devolvem dados de cliente **devem** chamar `operatorOwnsClient`
  antes de retornar o `UIIntent`.

### T — Tampering
- **Risco:** resposta de tool / narração com `UIIntent` malformado corrompe a UI.
- **Mitigação:** `UIIntentSchema` (Zod) valida na **borda cliente** antes de montar; cada painel revalida
  seu `data` com sub-schema reusando os tipos dos services. Intent inválido é descartado, nunca renderizado.

### R — Repudiation
- **Risco:** ação sem trilha.
- **Mitigação:** render-tools são read-only e não disparam jobs (nada a repudiar). Ações com efeito
  (criar/ativar/analisar/landing) continuam nas tools `request_*`, logadas em `operation_logs`/`agent_events`.

### I — Information disclosure
- **Risco (a):** popout (2ª janela) recebendo diretivas de outra origem. **Mitigação:** `BroadcastChannel`
  é same-origin por design; validar shape na recepção.
- **Risco (b):** iframe de preview de landing apontando para domínio arbitrário (clickjacking/exfil).
  **Mitigação:** allowlist `*.b2tech.io`; rejeitar URL fora do domínio.
- **Risco (c):** PII em logs. **Mitigação:** sem email/token/PII em logs do bus; referência por id interno.
- **Risco (d):** cross-tenant. **Mitigação:** RLS + `operatorOwnsClient` nas render-tools (mesma barreira
  do resto da plataforma).

### D — Denial of service
- **Risco (a):** muitos `show` empilhando painéis / re-render. **Mitigação:** `MAX_ACTIVE_PANELS=6` + TTL;
  descarta o mais antigo ao estourar o teto.
- **Risco (b):** gestos disparando ações em rajada (wave D). **Mitigação:** debounce + histerese; gesto só
  atua no painel em foco.
- **Risco (c):** sem polling novo além do já existente (`/api/ultron/narrations`, `/api/dashboard/events`).

### E — Elevation of privilege
- **Risco:** render-tool usada como vetor de mutação/escalada.
- **Mitigação:** render-tools **nunca** mutam e nunca excedem o escopo do operador; nenhuma rota de escrita
  nova. Webcam exige consentimento explícito (getUserMedia por gesto do usuário), igual à screen-share atual.

## Checklist de PR (sensível)

- [ ] Render-tools de dados de cliente chamam `operatorOwnsClient` antes de retornar.
- [ ] `UIIntent` validado por Zod na borda cliente; intent inválido descartado.
- [ ] iframe de landing restrito a `*.b2tech.io`.
- [ ] Teto de painéis + TTL aplicados no Render Bus.
- [ ] Sem PII nos logs do bus/popout.
- [ ] Migration `ultron_narrations.render` nullable, RLS herdada, sem default que quebre compat.
- [ ] Dashboard clássico inalterado (regressão verificada).
