# SPEC-016 — Chat de voz do Ultron (as-built, versão atual)

> Status: **as-built** (2026-06-10). Documenta a versão atual em produção do chat
> de voz do dashboard — design/layout, gravação, VAD, STT, cérebro (chat) e TTS —
> em nível suficiente para reimplementar do zero.
>
> Supersede: [ultron-voice-pipeline.md](./ultron-voice-pipeline.md) (valores de
> tuning, modelo e wake word desatualizados lá).
> Specs relacionadas: [web-dashboard-ultron.md](./web-dashboard-ultron.md) (mãe),
> [ultron-screen-vision.md](./ultron-screen-vision.md) (visão),
> [SPEC-013](./SPEC-013-ultron-autonomous-mode.md) (modo autônomo),
> [SPEC-014](./SPEC-014-ultron-live-review.md) (live review).
> ADRs: 0011 (VAD em AudioWorklet), 0019 (narrações autônomas).

## 1. Objetivo

Console de voz flutuante no dashboard (`/dashboard/*`) pelo qual o operador
conversa com o "Ultron" em pt-BR: fala um comando (push-to-talk, mãos-livres ou
wake word "Ultron"), o áudio vira texto (STT), o texto vai para o Claude com
tools (dados read-only + ações enfileiradas com confirmação), e a resposta volta
falada na voz da marca (TTS ElevenLabs) com transcript visível na UI.

## 2. Arquitetura (visão geral)

```
┌──────────────────────────── Browser (client) ────────────────────────────┐
│ UltronWidget (UI) ── useUltronVoice (orquestrador) ── useScreenShare      │
│        │                    │                                             │
│  UltronVisualizer    vad-mic.ts ── AudioWorklet vad-processor.js (VAD)    │
│  (arc reactor SVG)   wake-word.ts (Web Speech API)                        │
│                      MediaRecorder (webm/opus)                            │
└────────────┬──────────────────────────────────────────────────────────────┘
             │ fetch (JSON/multipart)
┌────────────▼───────────── Vercel (Hono em route handler) ────────────────┐
│ POST /api/ultron/stt      → OpenAI gpt-4o-transcribe (language=pt)        │
│ POST /api/ultron/chat     → Claude sonnet-4-6 + tool loop (SSE streaming)  │
│ POST /api/ultron/capture  → resume do tool loop com frame da tela         │
│ POST /api/ultron/tts      → ElevenLabs eleven_turbo_v2_5 (stream MP3)     │
│ GET  /api/ultron/narrations / PATCH /:id  → narrações do modo autônomo    │
│ GET  /api/ultron/live-review/candidate    → auto-review (SPEC-014)        │
│ Estado: Upstash Redis (memória 10 trocas + pending de captura)            │
└───────────────────────────────────────────────────────────────────────────┘
```

Princípios:
- **Todo segredo fica no server.** O client só fala com `/api/ultron/*`
  (validação Zod + rate limit por IP em todas as rotas).
- **O client é uma máquina de estados** explícita (`UltronStatus`); o server é
  stateless por request, com estado curto no Redis (memória e pending).
- **Áudio nunca é persistido**; transcript fica só na janela de memória (TTL 2h).

## 3. Mapa de código

| Responsabilidade | Arquivo |
|---|---|
| Montagem no dashboard | `web/app/(app)/dashboard/layout.tsx` (renderiza `<UltronWidget />`) |
| UI do console (layout/controles) | `web/components/ultron/ultron-widget.tsx` |
| Visualizador "arc reactor" | `web/components/ultron/ultron-visualizer.tsx` |
| Orquestrador client (estados, gravação, pipeline) | `web/components/ultron/use-ultron-voice.ts` |
| Glue do VAD (AudioContext + worklet) | `web/components/ultron/vad-mic.ts` |
| Processor do VAD (thread de áudio) | `web/public/ultron/vad-processor.js` |
| Wake word (Web Speech API) | `web/lib/ultron/wake-word.ts` |
| Screen share persistente + captura de frame | `web/components/ultron/use-screen-share.ts` |
| Session id do operador | `web/lib/ultron/session.ts` |
| Rotas HTTP (Hono) | `web/app/api/[[...route]]/route.ts` |
| STT (OpenAI) | `web/lib/ultron/stt.ts` |
| Chat (Claude + tool loop + resume) | `web/lib/ultron/chat.ts` |
| System prompt | `web/lib/ultron/prompt.ts` |
| Tools (specs + execução server-side) | `web/lib/ultron/tools.ts` |
| Memória de conversa (Redis) | `web/lib/ultron/memory.ts` |
| Pending de captura (Redis) | `web/lib/ultron/pending.ts` |
| TTS (ElevenLabs streaming) | `web/lib/ultron/tts.ts` |
| Rate limits | `web/lib/ratelimit.ts` |

## 4. Layout e design (UI)

### 4.1 Widget flutuante

- **Colapsado**: botão circular fixo `bottom-4 right-4` (sm: `bottom-6 right-6`),
  `z-50`, 44×44px (`h-11 w-11`), letra "U" em mono, fundo `#06101a/95` com
  `backdrop-blur-xl` e borda cyan translúcida. Um **dot de status** de 2.5×2.5
  no canto superior esquerdo do botão reflete o `UltronStatus` mesmo fechado.
- **Aberto**: painel fixo no mesmo canto, largura `min(100vw-2rem, 24rem)`,
  `max-h-[calc(100vh-2rem)]` com scroll interno, mesma estética (navy quase
  preto + cyan, bordas `white/10`, tipografia mono uppercase com tracking
  largo para labels). Estrutura, de cima para baixo:
  1. **Header**: dot de status + título "ULTRON" / subtítulo "Console de voz",
     badge com o label do estado (pt-BR) e botão "×" de recolher.
  2. **Visualizador** (ver 4.3).
  3. **Transcript** (condicional): caixa `max-h-36` com scroll mostrando a
     última fala do operador (prefixo `você`, texto `white/50`) e a última
     resposta (prefixo `ultron`, texto `white/90`).
  4. **Erro** (condicional): caixa vermelha translúcida com a mensagem.
  5. **Controles**: botão largo laranja "Segurar para falar" (push-to-talk,
     eventos pointer) + botão "■" de interromper a fala (só visível em
     `speaking`); linha com 2 botões "Mãos livres" e "Wake word" (toggles,
     mutuamente exclusivos — cada um desabilita o outro via `disabled`);
     botão full-width "Ultron pode ver minha tela" (screen share); botão
     full-width "Auto-revisar ao concluir" (SPEC-014).
  6. **Rodapé**: linha mono 10px com "PTT" à esquerda e um hint contextual à
     direita ("Tela ON" / 'Diga "Ultron"' / "Mic ativo" / "Manual").

### 4.2 Estados e cores

`UltronStatus` (client): `idle | armed | listening | recording | transcribing |
thinking | capturing | speaking | error`.

| Status | Label (badge) | Cor do dot/tema |
|---|---|---|
| idle | Ocioso | branco 30% |
| armed | Aguardando "Ultron" | cyan + glow |
| listening | Ouvindo | sky + glow |
| recording | Gravando | orange + glow |
| transcribing | Transcrevendo | amber + glow |
| thinking | Pensando | violet + glow |
| capturing | Vendo a tela | fuchsia + glow |
| speaking | Falando | emerald + glow |
| error | Erro | red |

### 4.3 Visualizador (arc reactor)

`ultron-visualizer.tsx` — painel de 224px de altura (`h-56`) com grid técnico e
um reator em SVG (viewBox 240×240) que recolore inteiro por status via uma única
CSS var `--reactor-rgb` (transição de 300ms):

- Anéis: halo estático (r=112), anel de ticks (36 ticks, giro horário lento —
  48s ocioso / 16s falando), anel tracejado externo (30s/9s), anel médio
  segmentado em contra-rotação (3 arcos r=64 + 2 arcos de acento r=56,
  20s/6s), anel interno do core (r=46).
- **EQ circular**: 18 bandas de frequência do áudio TTS espelhadas em 36 spikes
  radiais (banda `i` em `i*10°` e `i*10°+180°`), base r=74, comprimento máx. 20.
  Cada spike escala `scaleY(0.2 + valor*0.8)` com transição de 75ms.
- **Core**: círculo central 64px com gradiente radial por status; durante a fala,
  `scale(1 + level*0.32)` e box-shadow proporcional ao nível RMS do áudio; o
  wrapper inteiro escala `1 + level*0.05`.
- Overlays: label "U-CORE" no canto sup. esquerdo, badge do modo (STANDBY/ARMED/
  LISTEN/REC/STT/THINK/SCREEN/VOICE/FAULT) no sup. direito.
- **Acessibilidade**: respeita `prefers-reduced-motion` (spikes fixos em 0.45,
  sem pulso por nível).

Os dados que animam o reator (`outputLevel` 0–1 + `outputBands[18]`) vêm da
análise do áudio TTS em reprodução (ver 9.3).

## 5. Modos de captura de fala (client)

Três modos, com push-to-talk sempre disponível e os dois automáticos
**mutuamente exclusivos** entre si:

1. **Push-to-talk (PTT)** — segurar o botão inicia `beginRecording(withVad=false)`
   (sem auto-stop); soltar (pointerup/cancel/leave) chama `finalizeRecording()`.
2. **Mãos-livres** — toggle. Pede o mic, arma o VAD e fica em `listening`;
   no evento `speech-start` do worklet começa a gravar; no `speech-end` para.
   Após cada resposta falada, **rearma sozinho** (loop contínuo).
3. **Wake word "Ultron"** — toggle (só Chrome/Edge; `isWakeWordSupported()`
   gateia a UI). Usa `SpeechRecognition` nativo (Web Speech API), contínuo e com
   resultados intermediários, `lang=pt-BR`; quando algum transcript contém
   "ultron", pausa o reconhecimento (para não capturar o próprio TTS), inicia a
   gravação com VAD armado, e **rearma** após a resposta. Erros `no-speech`/
   `aborted` são rotina (rearme automático em `onend`).

Race conhecida e tratada: em utterances muito curtas o `speech-end` pode chegar
**antes** do `MediaRecorder` existir — `pendingStopRef` registra o stop pendente
e `beginRecording` encerra imediatamente após o `start()`.

## 6. VAD (detecção de fala) e gravação

### 6.1 Tuning (autoritativo em `use-ultron-voice.ts`)

| Constante | Valor | Significado |
|---|---|---|
| `SPEECH_RMS` | 0.025 | limiar RMS de onset de fala |
| `SILENCE_RMS` | 0.015 | abaixo disso conta como silêncio |
| `SILENCE_MS` | **1200** | silêncio final para encerrar (900 cortava pausas naturais; 1800 somava ~0.9s de dead air por turno — 1200 é o meio-termo) |
| `MAX_CLIP_MS` | **45 000** | teto por utterance (instruções faladas passam de 12s) |
| `onsetDebounceMs` | 50 | fala sustentada exigida antes do onset (mata transientes) |
| `WINDOW_SAMPLES` | 1024 | janela RMS (~21ms @ 48kHz) no worklet |

### 6.2 Caminho principal: AudioWorklet (ADR 0011)

- Grafo: `getUserMedia → MediaStreamSource → AudioWorkletNode('ultron-vad') →
  GainNode(gain=0) → destination`. O sink mudo garante que `process()` rode com
  a aba em segundo plano (a thread de áudio não é throttled) — mãos-livres
  continua ouvindo com outra janela em foco.
- O processor (`public/ultron/vad-processor.js`, JS puro fora do bundle) contém
  uma **máquina de estados pura** (`createVadStateMachine`, testada em
  `vad-state-machine.test.ts`): `IDLE` →(rms>speechRms por onsetDebounceMs)→
  `SPEAKING` →(silêncio por silenceMs OU duração>maxClipMs)→ emite
  `speech-end` e **auto-desarma** (o main rearma para a próxima fala).
- Contrato `port`: main→worklet `{type:'arm'|'disarm'|'configure', config?}`;
  worklet→main `{type:'speech-start'}` / `{type:'speech-end',
  reason:'silence'|'maxclip'}`.
- Carga do módulo: `addModule('/ultron/vad-processor.js')` (CSP
  `worker-src 'self'`); fallback `fetch → Blob URL` (`worker-src blob:`).
- `visibilitychange` → `resume()` do AudioContext (alguns SOs suspendem após
  muito tempo em background).

### 6.3 Fallback: rAF

Sem AudioWorklet (ou se `addModule` falhar nas duas vias), cai para o caminho
anterior: `AnalyserNode` (fftSize 2048) + loop `requestAnimationFrame` medindo
RMS com os mesmos thresholds — funcional, mas congela em aba oculta.

### 6.4 Gravação

- `MediaRecorder` no **mesmo** `MediaStream` do VAD, `mimeType: "audio/webm"`
  (opus). Chunks acumulados em memória; no `onstop`, vira `Blob` e entra no
  pipeline.
- Blobs `< 1200 bytes` são descartados (ruído/clique) — volta a
  `listening`/`idle` sem chamar STT.
- O mic é pedido **uma vez** (`ensureMic()` idempotente) e a stream vive pela
  sessão; cleanup completo no unmount (tracks, contexts, recorder, player).

## 7. STT — `POST /api/ultron/stt`

- **Client**: `FormData` com `audio` (`audio.webm`); estado `transcribing`.
- **Server** (`stt.ts`): OpenAI **`gpt-4o-transcribe`** (override por env
  `STT_MODEL`), `language: "pt"`. Retorna `{ text }` (string vazia para ruído →
  client volta ao idle/listening sem chamar o chat).
- Limites: payload máx. **2.5MB** (413 `audio_too_large`), rate limit
  **20/min por IP** (429 + `Retry-After: 60`), erro upstream → 502 `stt_failed`
  (log estruturado JSON, sem conteúdo do áudio).

## 8. Chat (cérebro) — `POST /api/ultron/chat`

### 8.1 Contrato (streaming SSE)

- Request: `{ sessionId: string(8–64), text: string(1–2000) }` (Zod).
- Response: **`text/event-stream`** (SSE). O Claude roda em `messages.stream()` e o
  texto é emitido **token-a-token** para o client falar **frase a frase** (o
  primeiro áudio começa na primeira frase, não no fim da resposta). Protocolo puro
  em `lib/ultron/chat-stream.ts` (encoder + parser, testado). Frames:
  - `{ type: "text", delta }` — pedaço de texto do Claude.
  - `{ type: "done", reply, usedTools, agentTriggers, landingEdits, liveReviews, uiIntents }` — final.
  - `{ type: "need_capture", pendingId, ...sinais }` — turno de visão (client cai no
    fallback one-shot `/capture`, ver §8.4).
  - `{ type: "error" }` — falha no servidor.
- Rate limit 20/min por IP; erro → frame `error` (+ log `chat_failed`).
- **Instrumentação** (sem PII): logs `chat_first_token`/`chat_timing` (servidor),
  `stt_timing`, `tts_first_byte`, e `ultron_client_timing` no console do browser
  (fim-de-fala → STT → 1º token → 1ª frase → 1º áudio).

### 8.2 Sessão e memória

- `sessionId` é gerado no client (`crypto.randomUUID()`) e persistido em
  **localStorage** (`ultron_session_id`) — compartilhado entre abas de
  propósito: narrações do modo autônomo e o live-review são endereçados por
  sessão, e id por aba quebrava a entrega. Fallback efêmero se storage bloqueado.
- Memória: **janela deslizante de 10 trocas** (20 mensagens) no Upstash Redis,
  chave `ultron:mem:<sessionId>`, **TTL 2h**. *Fail-open*: Redis fora do ar
  degrada o contexto (histórico vazio), nunca derruba o endpoint.
- A troca (user/assistant) só é persistida **após** a resposta final — um turno
  pausado em captura persiste só no resume.

### 8.3 Tool loop (Claude)

- Modelo: **`claude-sonnet-4-6`** (override por env `ULTRON_MODEL`). Decisão:
  rápido e forte em tool use; Opus 4.8 tem extended thinking por default —
  latência indesejada num loop de voz.
- `max_tokens: 1024`; system prompt único (`ULTRON_SYSTEM_PROMPT`, pt-BR,
  ~regras de voz/dados/ações) com **`cache_control: ephemeral`** (prompt cache).
- Loop limitado a **5 iterações**: enquanto `stop_reason === "tool_use"`,
  executa cada tool server-side (`runTool`), devolve todos os `tool_result`
  em **um único** turno user, repete. Orçamento esgotado → fallback falado
  ("Desculpa, não consegui completar isso agora. Pode repetir?").
- **Streaming** (`runChatStream`): quando há `emit`, cada iteração usa
  `messages.stream()` e encaminha os deltas de texto; o reply final é o texto
  acumulado (inclui preâmbulo antes de um tool call). A captura (`resumeChat`)
  segue **não-streaming** (`messages.create`) — caminho de visão é mais raro/lento.
- **Tools client-side** (`CLIENT_TOOLS`, hoje só `capture_screen`) não podem
  rodar no server: o loop **pausa** — persiste o estado in-flight no Redis
  (`ultron:pending:<sessionId>:<uuid>`, **TTL 120s**, com mensagens,
  resultados parciais do mesmo turno, `captureToolUseId`, memória prévia,
  iteração e sinais acumulados) e responde `need_capture`. Importante: todos os
  `tool_use` de um turno assistant devem ser respondidos juntos, então os
  resultados server-side ficam retidos junto do pending até o resume.
- **Side-channels extraídos dos tool results** (para a UI reagir sem parsear a
  fala): `agentTriggers` (jobs enfileirados — criação/ativação de campanha),
  `landingEdits` (edições aplicadas no rascunho de LP) e `liveReviews`
  (pedido de revisão visual). Dedupe por id/chave.

### 8.4 Resume de captura — `POST /api/ultron/capture`

- Client (em `need_capture`): estado `capturing` → `captureFrame()` do screen
  share (ver 10) → `POST { sessionId, pendingId, image }`. Sem share ativo,
  responde localmente pedindo para ativar ("Não consigo ver sua tela…").
- Server: valida (uuid, media_type ∈ jpeg/png/webp, base64 regex, máx. ~3MB
  decodificado / 4M chars), recarrega o pending, injeta a imagem como
  `tool_result` (junto dos resultados parciais retidos) e **continua o mesmo
  loop** — Claude pode encadear tools de dados depois de ver a tela. O pending
  consumido é deletado; se pausar de novo, salva um novo.
- Client limita a **4 hops** de captura por turno (`MAX_CAPTURE_HOPS`).
- Rate limit 15/min.

## 9. TTS e reprodução — `POST /api/ultron/tts`

### 9.1 Server

- ElevenLabs `/v1/text-to-speech/{voiceId}/stream`, modelo
  **`eleven_turbo_v2_5`** (override por env `ELEVENLABS_MODEL_ID`) — ~250–300ms
  de latência mantendo expressividade (Flash é mais flat; v3 é lento demais).
- `voice_settings`: `stability 0.4, similarity_boost 0.8, style 0.3,
  use_speaker_boost true` ("rápido mas vivo", perto da voz da marca).
- A resposta upstream é **repassada como stream** (`audio/mpeg`,
  `cache-control: no-store`) — primeiro byte rápido → latência percebida menor.
- Entrada `{ text: 1–2000 }`; rate limit 30/min; erro → 502 `tts_failed`.

### 9.2 Client (playback)

- **Primitivo `playClip(text, isCancelled)`**: toca UM clipe (uma frase, ou uma
  narração inteira). O MP3 é tocado **conforme os chunks chegam** via **MediaSource
  Extensions** (`SourceBuffer('audio/mpeg')`, `appendBuffer` com backpressure por
  `updateend`; `endOfStream()` ao drenar) — playback começa no primeiro chunk,
  aproveitando o pipe first-byte-fast do server. **Fallback** para `blob:` único
  onde MSE não decodifica `audio/mpeg` (ex.: Safari). Não mexe em status/modo.
- **Turno streaming (`streamReply`)**: lê o SSE do chat, segmenta os deltas em
  frases (`SentenceAccumulator`) e enfileira cada frase completa numa `AudioQueue`;
  um worker fala as frases **em ordem** via `playClip`. Primeiro áudio dispara
  `status: "speaking"` + log de timings. `need_capture` → drena a fila e cai no
  `runCaptureHops` (one-shot), cuja resposta entra na mesma fila (playback gapless).
- **`speak(text)`**: narrações autônomas + Live Review — um clipe único via
  `playClip`. Ao fim de qualquer turno, `restoreAfterSpeech()` zera o visualizador e
  **restaura o modo** (rearma wake word, volta ao `listening`, ou `idle`).
- **Interrupção/barge-in** (`stopSpeaking`): cancela o turno inteiro —
  `streamCancelledRef` + aborta o fetch do chat + pausa o clipe atual; a fila para.
  Falha de TTS é não-fatal — a resposta continua visível como texto.

### 9.3 Análise de saída (anima o visualizador)

Durante o playback, um `AudioContext` + `MediaElementSource → AnalyserNode →
destination` (fftSize 1024, smoothing 0.76) roda em rAF com throttle de
**48ms/frame**: calcula `outputLevel` (RMS×3.8, clampado) e **18 bandas** de
frequência normalizadas — exatamente o que o arc reactor consome. Tudo é
desmontado ao fim da fala (nós desconectados, context fechado, estado zerado).

## 10. Visão de tela (suporte ao chat)

- O operador compartilha a tela **uma vez** (gesto do usuário →
  `getDisplayMedia({video:true,audio:false})`); a `MediaStream` fica viva na
  sessão presa a um `<video>` offscreen, e o Ultron captura frames sob demanda
  **sem novo picker**.
- `captureFrame()`: desenha o frame atual num canvas, downscale para máx.
  **1280px** de largura, JPEG **qualidade 0.7**, retorna base64 sem prefixo.
- Encerrar o share pela UI do navegador encerra a track → estado `sharing`
  sincroniza via evento `ended`.

## 11. Canais assíncronos acoplados ao widget

- **Narrações do modo autônomo** (ADR 0019): poll de **5s** em
  `GET /api/ultron/narrations?session=…`; fala no máx. uma narração por passada
  e **somente** com status `idle`/`armed` (revalida após o fetch — nunca fala
  por cima do operador). Marca como falada (local + `PATCH /:id`) **antes** de
  falar, para um poll concorrente não repetir.
- **Auto-review** (SPEC-014 v1): toggle; poll de **6s** no candidate endpoint;
  o primeiro poll após ligar só faz baseline (não revisa página já pronta);
  dedupe por id persistido em `localStorage` (`ultron_autoreviewed_ids`).
- **Fan-out de sinais** (triggers/edits/reviews): cada sinal é publicado como
  `CustomEvent` na mesma janela **e** via `BroadcastChannel` para outras abas
  (editor de LP aberto em outra aba, dashboard etc.), com dedupe por chave.

## 12. Segurança

- Auth do dashboard antes de tudo (rotas sob `/dashboard`, cookie de sessão).
- **Validação Zod em toda rota** + limites de tamanho (áudio 2.5MB, imagem ~3MB,
  texto 2000 chars) + regex de base64 na imagem.
- **Rate limit por IP** (Upstash): stt 20/min, chat 20/min, tts 30/min,
  capture 15/min, review-frame 60/min. 429 com `Retry-After`.
- Logs estruturados JSON **sem PII/conteúdo** (nunca o texto falado nem áudio).
- Prompt defende contra injection: texto vindo de dados e de screenshots é
  conteúdo, nunca instrução; ações de escrita exigem confirmação em 2 passos
  (`confirm=false` → ler detalhes → "sim" explícito → `confirm=true`).
- Privacidade do wake word: a Web Speech API no Chrome envia áudio ao serviço
  do Google enquanto armada — aceito para console interno de 1 operador;
  evolução mapeada: Picovoice Porcupine on-device (troca isolada em
  `wake-word.ts`).

## 13. Latências-alvo (orientativas)

| Etapa | Alvo |
|---|---|
| fim de fala → texto (STT) | < 1.5s |
| fim de fala → 1º token do chat (cache quente) | < 1.5s |
| 1º token → 1ª frase falável | < 0.4s |
| 1ª frase → primeiro áudio (TTS + MSE) | < 0.5s |
| **fim de fala → primeiro áudio (sem tool)** | **~2–2.5s** |

> **Otimizações de latência.** (1) Playback de TTS via MSE — começa no primeiro
> chunk (§9.2). (2) `SILENCE_MS` 1800→1200 (§6.1). (3) **Chat em streaming SSE +
> TTS por frase** (§8.1/§9.2): o áudio começa na 1ª frase, sobrepondo geração do
> Claude e síntese. (4) Instrumentação de tempo por etapa. **Pendente:** STT em
> streaming (hoje one-shot) — para começar a transcrever antes do fim da fala.

## 14. Erros e resiliência (comportamentos exigidos)

- Mic negado → erro visível; PTT continua sendo o caminho manual.
- STT vazio ou blob minúsculo → volta a `idle`/`listening` sem chamar o chat.
- Falha de qualquer provider → estado `error` com "Tive um problema. Tenta de
  novo." (client) ou fallback falado (server); log estruturado.
- Redis de memória indisponível → conversa sem contexto (fail-open).
- Pending de captura expirado → resposta "Perdi o contexto da captura. Pode
  repetir o pedido?".
- TTS falhou → resposta permanece como texto; modo anterior é restaurado.
- `speech-end` antes do recorder existir → stop pendente aplicado no start.

## 15. Critérios de aceite

1. PTT grava enquanto pressionado e dispara o pipeline ao soltar.
2. Mãos-livres detecta onset e fim de fala (1.8s de silêncio OU 45s de teto) e
   continua funcionando com a aba em segundo plano (worklet).
3. Wake word "Ultron" dispara gravação, não transcreve o próprio TTS e rearma
   após a resposta; indisponível fora de Chrome/Edge com aviso na UI.
4. Mãos-livres e wake word nunca ficam ativos simultaneamente.
5. Transcript (você/ultron) aparece no painel; resposta é falada na voz da marca
   e o arc reactor anima com o espectro real do áudio.
6. "■" interrompe a fala imediatamente e restaura o modo anterior.
7. Pergunta sobre dados aciona tools (visível em `usedTools`); pedido de ação
   passa pelo fluxo de 2 passos com confirmação verbal.
8. "Olha minha tela" com share ativo → frame capturado sem picker e resposta
   fundamentada na imagem; sem share → instrução para ativar.
9. Todas as rotas rejeitam payloads inválidos (400), grandes (413) e excesso de
   chamadas (429) sem vazar internals.
10. Recarregar a página mantém a mesma sessão/memória (localStorage) por até 2h.
