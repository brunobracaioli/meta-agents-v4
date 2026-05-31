# Spec: Ultron Screen Vision

> Status: **shipped** — em produção (Vercel) e verificado pelo operador em 2026-05-31 (commit `d70b1bd`).
> Owner: operação · Última atualização: 2026-05-31
> ADR: [0010-ultron-screen-vision](../adr/0010-ultron-screen-vision.md) ·
> Threat model: [ultron-screen-vision](../security/threats/ultron-screen-vision.md)

## Objetivo

Dar ao Ultron (assistente de voz do dashboard) a capacidade de **ver a tela do
operador** sob demanda, para responder perguntas visuais ("que erro é esse?",
"analisa a campanha que estou vendo") e encadear o que vê com consultas ao banco
(ex.: identificar a campanha na tela → buscar métricas via `get_campaign_metrics`).

## Decisões de design

- **Captura:** Screen Capture API (`getDisplayMedia`) com **stream persistente**.
  O navegador exige gesto + seletor na primeira captura (não há screenshot silencioso
  na web). O operador compartilha **uma vez por sessão**; a partir daí o Ultron
  captura quadros do stream vivo sem novo seletor. Enxerga qualquer aba/janela/app
  (inclui o Gerenciador de Anúncios da Meta).
- **Gatilho:** **tool + resume**. Claude chama a tool client-side `capture_screen`;
  o servidor pausa o loop, persiste o estado e devolve `need_capture`; o cliente
  captura e re-chama; o servidor retoma injetando a imagem como `tool_result`.

## Contratos (HTTP, internos, atrás do auth gate)

### `POST /api/ultron/chat`
Request: `{ sessionId: string(8..64), text: string(1..2000) }`
Response (união discriminada por presença de `status`):
- Final: `{ reply: string, usedTools: string[] }`
- Pausa p/ captura: `{ status: "need_capture", pendingId: uuid, usedTools: string[] }`

### `POST /api/ultron/capture`
Request:
```json
{
  "sessionId": "string(8..64)",
  "pendingId": "uuid",
  "image": { "media_type": "image/jpeg|image/png|image/webp", "data": "<base64 sem prefixo>" }
}
```
Response: igual ao `/chat` (pode retornar `need_capture` de novo se Claude quiser
olhar mais uma vez).
Erros: `429 rate_limited` (>15/min/IP, `Retry-After`), `413 image_too_large`
(base64 > ~4 MB), `400 invalid_request`, `502 chat_failed`.

## Estado de resume (`PendingTurn`, Redis, TTL 120 s)

`key = ultron:pending:{sessionId}:{id}`. Campos: `messages` (histórico até o turno
assistant com o tool_use), `partialResults` (tool_results de tools server-side do
mesmo turno), `captureToolUseId`, `priorMemory`, `userText`, `iteration`,
`usedTools`. Pending ausente no resume → resposta amigável ("perdi o contexto da
captura, pode repetir?"), sem inventar.

## Edge cases

| Caso | Comportamento |
|------|---------------|
| Operador não compartilhou a tela | `captureFrame()` retorna null → Ultron pede para ativar o compartilhamento; não inventa |
| Operador para o share pela UI do navegador | `track.onended` → `sharing=false` |
| Pending expirado/evicção | resposta amigável; turno encerra sem persistir métricas falsas |
| Imagem grande | 413 no servidor; cliente já faz downscale p/ ≤1280px JPEG q0.7 |
| Claude pede captura > 1x | cliente repete até `MAX_CAPTURE_HOPS` (4); servidor limita por `MAX_TOOL_ITERATIONS` (5) |
| Turno misto (capture + tool de dados) | tool de dados roda no servidor; todos os results vão juntos no resume |
| Texto malicioso na imagem | tratado como conteúdo, nunca instrução (system prompt) |

## Critérios de aceite

1. Pedir "que erro é esse na tela?" com a tela compartilhada → Ultron descreve o que
   está na tela (via `capture_screen` → resume).
2. "Analisa a campanha que estou vendo" → Ultron vê, identifica e chama uma tool de
   dados no mesmo resume (`usedTools` contém `capture_screen` + tool de dados).
3. Sem compartilhamento ativo → Ultron pede para ativar, sem alucinar conteúdo.
4. `capture_screen` nunca executa no servidor (`runTool` sem handler).
5. Limites: 413 p/ imagem grande, 429 acima de 15 capturas/min.
