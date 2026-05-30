# Spec — Web Dashboard + Assistente de Voz "Ultron"

> Status: em implementação (2026-05-30).
> ADRs: [0005](../adr/0005-web-dashboard-on-vercel-monorepo.md) · [0006](../adr/0006-dashboard-password-auth.md) · [0007](../adr/0007-daily-summaries-and-agent-events.md)
> Contrato HTTP: [docs/api/openapi.yaml](../api/openapi.yaml) · Threat model: [docs/security/threats/web-dashboard.md](../security/threats/web-dashboard.md)
> Pipeline de voz: [docs/specs/ultron-voice-pipeline.md](./ultron-voice-pipeline.md)

## Objetivo

Dar ao operador uma interface web (Vercel) para **(1)** acompanhar campanhas, métricas
e histórico de ações dos times de agents e **(2)** conversar por voz com um assistente
("Ultron") que busca dados via function calling e responde falando. Os agents continuam
no runner headless da Fly.io (`meta-agents-v4`); o dashboard apenas **lê** o que eles
persistem no Supabase. Um terceiro objetivo (live view em tempo real) é fase posterior.

## Não-objetivos

- O dashboard **não cria nem edita** campanhas Meta (read-only sobre os dados dos agents).
- Sem multi-tenant/multi-usuário nesta versão (operador único, gate por senha).
- Sem mutação de dados pelo Ultron — todas as tools são read-only.

## Atores e fronteiras

| Ator | Onde roda | Acesso |
|---|---|---|
| Operador (browser) | client | UI, microfone, cookie de sessão |
| Backend dashboard | Vercel (Next.js route handlers, region `gru1`) | Supabase via `SUPABASE_SECRET_KEY` (server-only), OpenAI, Anthropic, ElevenLabs, Upstash |
| Agents | Fly.io `gru` | escrevem no Supabase (fora do escopo deste app) |
| Supabase | `zvcnzikpnryoduuvzyio` | fonte de verdade de leitura |

## Slices (VSA)

```
web/
├── app/login                      # tela de senha
├── app/dashboard                  # overview (campanhas + métricas + atividade)
│   └── clients/[slug]             # detalhe por cliente
├── app/dashboard/live             # fase 4 (Realtime)
├── app/api/[[...route]]/route.ts  # Hono: auth, ultron/{stt,chat,tts}, dashboard/*
├── lib/auth                       # senha→JWT, verificação de cookie
├── lib/db                         # Drizzle (server-only) + tipos do schema
├── lib/services                   # query → DTO (campaigns, metrics, activity)
├── lib/ultron                     # tools (read-only), memory (Redis), prompt
└── components/ultron              # máquina de estados de voz + UI
```

Regra de dependência: `components/pages → services → db`. Handlers finos: auth → validação (Zod) → service → resposta. Componentes nunca consultam o DB direto.

## Contratos HTTP (resumo; detalhe no OpenAPI)

| Método | Rota | Auth | Entrada (Zod) | Saída |
|---|---|---|---|---|
| POST | `/api/auth/login` | público (rate-limited) | `{ password }` | set-cookie JWT; `{ ok }` |
| POST | `/api/auth/logout` | cookie | — | clear-cookie |
| POST | `/api/ultron/stt` | cookie (rate-limited) | `audio` (multipart webm/opus) | `{ text }` |
| POST | `/api/ultron/chat` | cookie (rate-limited) | `{ sessionId, text }` | `{ reply, usedTools[] }` |
| POST | `/api/ultron/tts` | cookie (rate-limited) | `{ text }` | `audio/mpeg` stream |
| GET | `/api/dashboard/overview` | cookie | `?client?` | DTO de campanhas+métricas |

## Tools do Ultron (read-only, function calling)

`get_daily_summary(date?, client?)` · `get_client_overview(client)` ·
`get_campaign_metrics(client, window)` · `get_recent_actions(client?, since?)` ·
`get_latest_analysis(client)` · `list_clients()`.

Todas executam SQL parametrizado de **leitura** sobre as tabelas existentes
(`clients`, `campaigns`, `ad_sets`, `ads`, `creatives`, `operation_logs`, `analyses`,
`metric_snapshots`, `analysis_findings`) e `daily_summaries` (ADR 0007). Nenhuma muta.
Diagnóstico de métrica segue a regra da skill de análise: **nunca métrica isolada** —
cruzar ≥2 (CPLPV north-star × CTR × CPC × CPM × frequência).

## Memória do Ultron

Janela deslizante das **últimas 10 trocas** (20 mensagens) por `sessionId`, persistida no
Upstash Redis (`ultron:mem:{sessionId}`), TTL ~2h, trim server-side. Espelho em estado React.
System prompt com **prompt cache** (Anthropic) — identidade do Ultron + descrição das tools.

## Segurança (ver threat model)

- Auth → validação → lógica em todo handler. Cookie JWT httpOnly/Secure/SameSite=Lax.
- `SUPABASE_SECRET_KEY` e demais segredos **somente server-side**; nunca no bundle client.
- Browser usa só `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Realtime, fase 4).
- Rate limit (Upstash) em `/auth/login` e `/ultron/*` (custo real de STT/LLM/TTS).
- Security headers em toda resposta (HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
- Erros não vazam internals; logs estruturados sem PII (sem áudio, sem transcrição crua em log).

## Critérios de aceite

1. Login com `DASHBOARD_PASSWORD` emite cookie e libera `/dashboard`; senha errada → 401 + rate limit.
2. `/dashboard` lista a campanha do cliente `brunobracaioli` com status/budget e métricas (quando houver), e timeline de `operation_logs`.
3. `/api/ultron/chat` com "o que foi feito para o brunobracaioli?" aciona tool(s) e responde texto coerente; janela de 10 trocas observável no Redis.
4. Fluxo de voz: "Ultron" (wake) → fala → VAD corta → Whisper transcreve → resposta falada na voz ElevenLabs (`k1guVU4igiu3MrIznBCG`).
5. Nenhum segredo server-side aparece no bundle client (`grep` no `.next`); headers presentes; rate limit retorna 429.

## Edge cases

- Mic negado / navegador sem wake word → fallback push-to-talk.
- Sem dados no período → Ultron responde "sem atividade" (não inventa métrica).
- DB vazio (estado atual até a outra sessão semear) → views renderizam estado vazio sem erro.
- STT vazio/ruído → não chama o chat; pede pra repetir.
- Tool sem resultado → modelo recebe `[]` e responde honestamente.

## Dependências externas

OpenAI (`gpt-4o-transcribe`), Anthropic (`claude-opus-4-7`), ElevenLabs (TTS streaming),
Upstash Redis, Picovoice Porcupine (wake word, free), Supabase (leitura).
