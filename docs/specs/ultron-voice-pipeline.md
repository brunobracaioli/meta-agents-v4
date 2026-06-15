# Spec — Pipeline de voz do Ultron

> Status: **superseded** por [SPEC-016-ultron-voice-chat.md](./SPEC-016-ultron-voice-chat.md)
> (as-built 2026-06-10 — tuning de VAD, modelo do chat e layout atualizados lá).
> Texto abaixo preservado como histórico (2026-05-30). Spec mãe: [web-dashboard-ultron.md](./web-dashboard-ultron.md).

## Objetivo

Conversa por voz, mãos livres, com baixa latência: o operador diz "Ultron",
fala um comando, e ouve a resposta na voz da marca (ElevenLabs). O cérebro é o
Claude com function calling (tools read-only de dados). Memória de 10 trocas.

## Stack escolhida (decisão do operador)

`wake word → VAD (fim de fala) → MediaRecorder → OpenAI Whisper (STT) → Claude
(brain + tools) → ElevenLabs (TTS streaming)`.

### Wake word — implementação atual: Web Speech API (Porcupine adiado)

O wake word "Ultron" usa o **SpeechRecognition nativo do navegador** (Web Speech API),
não o Picovoice Porcupine. Motivo: o cadastro do Picovoice exige **aprovação de uso
comercial** (pode demorar/recusar), o que travaria a entrega. A Web Speech API não exige
conta/chave e funciona em **Chrome/Edge**.

- `web/lib/ultron/wake-word.ts`: escuta contínua; ao transcrever "ultron", dispara a
  gravação. Pausa enquanto trata o comando + resposta (não captura o próprio TTS) e
  re-arma depois. Modo mutuamente exclusivo com "mãos livres".
- VAD de fim de fala: ver seção **VAD em AudioWorklet** abaixo (antes era um
  detector de energia em `AnalyserNode` + `requestAnimationFrame`).
- Fallbacks sempre disponíveis: **push-to-talk** e **mãos livres** (não dependem do wake word).

### VAD em AudioWorklet (ouvir com a aba em segundo plano)

> Decisão: [ADR 0011](../adr/0011-ultron-vad-audioworklet.md). Implementado em
> 2026-05-31.

O VAD (onset da fala + silêncio de encerramento) roda num **AudioWorklet**
(`web/public/ultron/vad-processor.js`), na thread de áudio em tempo real. Diferente
do `requestAnimationFrame`, essa thread **não** é congelada quando a aba está em
segundo plano — então o modo **mãos-livres** continua ouvindo o operador mesmo com
outra aba/janela em foco ou a janela minimizada.

**Grafo de áudio:** `getUserMedia → MediaStreamSource → AudioWorkletNode('ultron-vad')
→ GainNode(gain=0) → destination`. O sink mudo garante que `process()` seja chamado
em background sem emitir som. O `MediaRecorder` consome o **mesmo** stream em
paralelo (webm → `/api/ultron/stt`, inalterado).

**Contrato de mensagens** (`AudioWorkletNode.port`):
- main → worklet: `{type:'arm'}` (reset → IDLE, passa a emitir), `{type:'disarm'}`
  (dormente), `{type:'configure', config}` (ajusta thresholds em runtime).
- worklet → main: `{type:'speech-start'}` quando o onset é sustentado por
  `onsetDebounceMs`; `{type:'speech-end', reason:'silence'|'maxclip'}` no
  encerramento. O worklet **auto-disarma** após `speech-end` (o main re-arma para a
  próxima fala).

**Máquina de estados pura** (`createVadStateMachine`, no mesmo arquivo, testável
isolada): `IDLE` → (onset `rms > speechRms` por `onsetDebounceMs`) → `SPEAKING` →
(silêncio `rms < silenceRms` por `silenceMs`, **ou** duração > `maxClipMs`) →
emite evento e volta a `IDLE`. Defaults: `speechRms 0.025`, `silenceRms 0.015`,
`silenceMs 900`, `maxClipMs 12000`, `onsetDebounceMs 50` (espelham as constantes de
`use-ultron-voice.ts`). Testada em `web/lib/ultron/vad-state-machine.test.ts`
carregando o arquivo shipado num sandbox (zero duplicação de lógica).

**Encapsulamento:** `web/components/ultron/vad-mic.ts` cria o `AudioContext`/grafo e
carrega o módulo via `audioWorklet.addModule('/ultron/vad-processor.js')` (same-origin,
permitido por `worker-src 'self'`); se falhar, faz fallback `fetch → Blob →
addModule(blobURL)` (`worker-src blob:`). Nenhuma mudança de CSP foi necessária.

**Fallback sem regressão:** navegadores sem AudioWorklet (ou se o `addModule` falhar
nas duas vias) caem no caminho **rAF** anterior (`vadMode: 'raf'`) — funciona como
antes, inclusive o congelamento em background.

**Limite conhecido:** o **gatilho por wake word** ("Ultron") usa a Web Speech API do
Chrome, que o próprio Chrome suspende em abas ocultas — isso **não** é corrigido
pelo worklet (Picovoice foi descartado). Para falar com a janela trocada, use
**mãos-livres**. Uma vez gravando, o auto-stop por silêncio (worklet) é confiável em
qualquer modo.

**Trade-offs:** só Chrome/Edge; no Chrome o áudio do reconhecimento vai para o serviço do
Google enquanto "armado" (menos privado que on-device). Aceitável para dashboard interno
com 1 operador. **Evolução:** migrar para **Picovoice Porcupine** (on-device, privado)
quando/se a conta for aprovada — troca isolada em `wake-word.ts`.

## Máquina de estados (client)

```
        ┌────────────────────────── idle (wake-listen: Porcupine ouvindo "Ultron") ◄─┐
        │ wake detectado                                                              │
        ▼                                                                             │
   recording (VAD ativo; grava webm/opus até silêncio ou timeout 12s) ──fala vazia──►┤
        │ fim de fala (VAD)                                                           │
        ▼                                                                             │
   transcribing (POST /api/ultron/stt → texto) ──texto vazio/erro──────────────────►┤
        │ texto                                                                       │
        ▼                                                                             │
   thinking (POST /api/ultron/chat → reply; pode acionar tools) ──erro──────────────►┤
        │ reply                                                                       │
        ▼                                                                             │
   speaking (POST /api/ultron/tts → stream MP3; toca) ──fim do áudio / barge-in──────┘
```

Estados expostos na UI com indicador visual (ocioso / ouvindo / transcrevendo /
pensando / falando) e botão **push-to-talk** como fallback (pula o wake word).

## Componentes / hooks (client)

- `useWakeWord()` — `@picovoice/porcupine-web` em Web Worker; keyword "Ultron" (`.ppn`
  gerado no console Picovoice, free) + `PICOVOICE_ACCESS_KEY`. `onWake → start recording`.
  Só ativo quando o operador "liga" o Ultron (toggle), respeitando privacidade do mic.
- `useVad()` — `@ricky0123/vad-web` (Silero) detecta início/fim de fala; corta a gravação
  no silêncio (~700ms) ou no timeout. Evita mandar áudio gigante (anti-DoS/custo).
- `useRecorder()` — `MediaRecorder` (audio/webm;codecs=opus); produz Blob ≤ ~1MB.
- `usePlayer()` — toca o stream do `/tts`; suporta **barge-in** (novo wake interrompe a fala).

## Endpoints (server, validação Zod, rate-limited)

### POST /api/ultron/stt
- Entrada: multipart `audio` (webm/opus, limite de tamanho/duração).
- OpenAI `gpt-4o-transcribe`, `language=pt`. Retorna `{ text }`. String vazia se ruído.

### POST /api/ultron/chat
- Entrada: `{ sessionId, text }`.
- Carrega janela (Redis), monta `messages` + system prompt **cacheado**, define tools.
- Loop tool-use: enquanto o modelo pedir tool → executa SQL read-only → devolve `tool_result`
  → repete (cap de iterações, ex.: 5). Resposta final em texto.
- Persiste o novo par (user/assistant) e faz trim para 10 trocas. Retorna `{ reply, usedTools }`.
- Modelo: `claude-opus-4-7` (qualidade). Tradeoff de latência mitigado por prompt cache.

### POST /api/ultron/tts
- Entrada: `{ text }`. ElevenLabs streaming, `voice_id = ELEVENLABS_VOICE_ID`
  (`k1guVU4igiu3MrIznBCG`), modelo multilíngue. Responde `audio/mpeg` em stream
  (primeiro byte rápido → menor latência percebida).

## Latências-alvo (orientativas)

| Etapa | Alvo |
|---|---|
| wake → início da gravação | < 300ms |
| fim de fala → texto (STT) | < 1.5s |
| texto → 1º token (chat, cache quente) | < 1.5s |
| reply → 1º áudio (TTS stream) | < 1s |
| **ponta-a-ponta (sem tool)** | **~3–4s** |

## Erros e resiliência

- Mic negado → desliga wake, mostra push-to-talk e instrução.
- STT vazio → volta a `idle` sem chamar chat.
- Falha de provider (OpenAI/Anthropic/ElevenLabs) → mensagem curta falada/texto "tive um problema, repete?"; log estruturado do erro (sem conteúdo).
- Rate limit atingido → 429 tratado na UI ("muitas requisições, aguarde").
- Barge-in: novo wake durante `speaking` para o áudio e reinicia o ciclo.

## Privacidade

- Wake word roda **on-device** (Porcupine WASM) — áudio só sai do browser após o wake,
  e somente o trecho falado (não áudio contínuo).
- Sem persistência de áudio; transcrição não é logada crua (PII potencial).
- Janela de memória com TTL curto no Redis.

## Custo (mitigações)

Rate limit por sessão, memória curta (10 trocas), system prompt cacheado, resposta TTS
só do texto final (não de passos intermediários), VAD para não transcrever silêncio.
