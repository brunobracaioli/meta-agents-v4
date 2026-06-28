# 0032 — STT em streaming para o Ultron (OpenAI Realtime via token efêmero)

- **Status:** proposed (gated — ver Gate abaixo)
- **Data:** 2026-06-28
- **Decisores:** Bruno Bracaioli (operador), Claude Code
- **Relacionados:** SPEC-016 (voice chat), ADR 0011 (VAD via AudioWorklet),
  memória `ultron-voice-latency-optimization`, `ultron-vad-cutoff-fix-and-worktree-gotcha`

## Context

Meta: reduzir ao extremo o tempo "operador para de falar → Ultron começa a falar".
Já entregue e em prod: streaming SSE do Claude + TTS por frase (MSE), prompt cache,
I/O pré-chamada em paralelo, STT via `gpt-4o-mini-transcribe` (env `STT_MODEL`),
`SILENCE_MS` 1800→1200→1000, e o bitrate de gravação 32kbps.

Medições em prod (ultronads.io, 2026-06-28) decompõem a latência percebida (~3,6–4,2s):

| pedaço | tempo | observação |
|---|---|---|
| VAD silêncio final (floor) | ~1,0s | fixo; 900ms regrediu o cutoff de pausas naturais |
| STT round-trip do client | 1,4–2,0s | servidor `stt_timing` vê só 0,8–1,3s; o resto é **UPLOAD** do blob pós-fala |
| chat → 1ª frase | ~0,9s | é o Claude; pouco headroom barato |
| TTS 1º byte | ~0,25–0,3s | já ótimo |

Os levers baratos foram exauridos (mini, VAD trim, bitrate, TTS já no limite). Os dois
maiores pedaços — **VAD floor (~1,0s) + STT round-trip (1,4–2,0s)** — somam ~65–70% do
total e compartilham a mesma causa estrutural: **o STT só começa DEPOIS do fim da fala**
(espera o silêncio do VAD, depois sobe o clip inteiro, depois transcreve one-shot).

O único lever que colapsa os dois é transcrever **enquanto** o operador fala.

## Decision

Adotar **STT em streaming via OpenAI Realtime (transcription) com token efêmero +
WebSocket browser→OpenAI** (Opção A):

1. **Token efêmero (servidor):** novo endpoint (ex.: `POST /api/ultron/stt-token`) que,
   autenticado/escopado pelo operador (ADR 0026), pede à OpenAI uma `client_secret`
   de sessão de transcrição com **TTL curto** e devolve só esse token ao browser.
   A `OPENAI_API_KEY` **nunca** vai ao client.
2. **Captura PCM (client):** reaproveitar o **AudioWorklet que já existe** para o VAD
   (`public/ultron/vad-processor.js` / `vad-mic.ts`) para extrair PCM16 do mesmo
   `MediaStream` e enviar os frames pelo WS durante a fala — sem MediaRecorder/webm
   no caminho quente.
3. **Endpointing:** usar o VAD local (já temos) e/ou o server-VAD da OpenAI para
   marcar fim de fala; no `speech-end` o transcript final já está ~pronto → o
   `/api/ultron/chat` (SSE, inalterado) dispara quase imediatamente.
4. **CSP:** adicionar `wss://api.openai.com` (e `https://api.openai.com` p/ o token)
   ao `connect-src` (hoje `'self' blob: https://*.supabase.co wss://*.supabase.co
   https://challenges.cloudflare.com`).
5. **Fallback:** se WS falhar (token expirado, rede, browser sem AudioWorklet), cair
   para o caminho atual (MediaRecorder→blob→`POST /api/ultron/stt` one-shot). O
   one-shot continua sendo a rede de segurança e o caminho de teste.
6. **Instrumentação (sem PII):** medir `stt_partial_first_ms`, `stt_final_ms`
   (fim-de-fala → transcript final), reaproveitando o padrão de logs atual.

### Gate (disciplina data-driven)

Só implementar se, **após** os levers baratos (bitrate 32kbps + poll backoff) e
re-medição em prod, **VAD+STT ainda dominarem** e o percebido seguir acima de ~2,5s.
Se o bitrate sozinho derrubar o upload e o percebido chegar perto disso, reavaliar se a
complexidade se paga.

## Alternatives considered

- **B — relay pelo nosso servidor (client→nosso WS→OpenAI):** mais controle (token
  server-side, poderíamos pré-aquecer o `/chat`), mas WS persistente **não casa com o
  serverless da Vercel**; exigiria a máquina Fly (hoje host de cron) como ponte. Rejeitado
  por custo/infra desproporcional.
- **C — chunk cumulativo re-enviado a cada ~1,5s pro endpoint atual:** webm/opus não é
  decodificável por chunk isolado (só o 1º tem header), então teria que re-subir o blob
  acumulado → custo de transcrição multiplicado e ganho marginal. Rejeitado.
- **D — não fazer (ficar em ~3,6–4,2s):** válido se o operador considerar suficiente;
  registrado como saída do Gate.
- **Extrema — ElevenLabs Conversational AI (Claude como Custom LLM):** elimina round-trips
  mas reescreve todo o loop de tools/confirmação em dois passos. Fora de escopo.

## Consequences

**Prós:** colapsa VAD floor + upload + espera de STT → ganho estimado **~1,5–2s**
(percebido ~1,8–2,4s); é o salto pro "extremo".

**Contras / riscos e mitigações:**
- Complexidade e novos modos de falha (WS drop, token expira meio-stream) → fallback
  obrigatório pro one-shot; reconexão/expiração tratadas.
- Superfície de segurança do token efêmero → TTL curto, escopo mínimo (só transcrição),
  emitido por endpoint autenticado/escopado por operador; nunca expor a API key.
- Custo: Realtime transcription é mais caro que batch → desprezível p/ ferramenta de
  operador único; monitorar.
- CSP mais permissiva (`wss://api.openai.com`) → adição mínima e explícita.
- Precisão pt-BR do modelo realtime a validar vs. `gpt-4o-mini-transcribe` (ativação =
  gasto real; nome do cliente/números/"confirma" têm que vir certos) → testar em dev
  antes de prod, com o one-shot como fallback de qualidade.

**Implementação:** wave dedicada (não é flip de env como o mini foi). Testar E2E em dev
antes de ir pra prod; manter o one-shot como caminho de fallback permanente.
