# 0011 — VAD do Ultron em AudioWorklet (ouvir com a aba em segundo plano)

- Status: accepted
- Data: 2026-05-31
- Relacionado: [0010-ultron-screen-vision](0010-ultron-screen-vision.md),
  spec [ultron-voice-pipeline](../specs/ultron-voice-pipeline.md)

## Context

O cliente de voz do Ultron (`web/components/ultron/use-ultron-voice.ts`) detectava
atividade de voz (VAD — onset da fala e silêncio de encerramento) em loops de
`requestAnimationFrame`. O navegador **pausa o `requestAnimationFrame` em abas em
segundo plano** (e throttla timers), então, ao trocar de aba ou minimizar a janela,
a lógica que decide "começou/parou de falar" congelava — o Ultron deixava de
"ouvir" o operador no modo mãos-livres, mesmo com o microfone ainda capturando.

O operador precisa olhar o Gerenciador de Anúncios da Meta em outra janela/aba e,
ao mesmo tempo, falar com o Ultron. O Picovoice Porcupine foi explicitamente
descartado (cadastro/aprovação comercial pendente).

## Decision

Mover o VAD para um **AudioWorklet** (`web/public/ultron/vad-processor.js`), que
roda na **thread de renderização de áudio em tempo real**. Essa thread **não** é
throttled pela visibilidade da aba: enquanto houver um `AudioContext` ativo e um
`MediaStreamSource` do microfone conectado, `process()` continua sendo chamado a
taxa de áudio com a aba oculta.

- O worklet computa RMS por janela (~1024 samples) e roda uma **máquina de estados
  pura** (`createVadStateMachine`): `IDLE` → (onset com debounce) → `SPEAKING` →
  (silêncio de `SILENCE_MS` **ou** `MAX_CLIP_MS`) → emite `speech-start` /
  `speech-end`. Timers por contagem de samples (`sampleRate`), mais precisos que rAF.
- O grafo é `source → AudioWorkletNode → GainNode(gain=0) → destination`. O sink
  mudo garante que o nó tenha caminho até o `destination` e seja "puxado" pelo
  render mesmo em background, sem emitir som.
- O main thread (`use-ultron-voice.ts`) só reage a eventos discretos (iniciar/parar
  `MediaRecorder`), via `vad-mic.ts`, que encapsula contexto/grafo/carregamento.
- A máquina de estados pura é **testada diretamente** lendo o arquivo shipado e
  avaliando-o num sandbox (`vad-state-machine.test.ts`) — zero duplicação de lógica.

### Alternativas consideradas

- **Manter rAF**: rejeitado — é exatamente a causa do problema (throttling em
  background).
- **Web Worker comum + ScriptProcessorNode/postMessage de samples**: rejeitado —
  `ScriptProcessorNode` é deprecado e roda no main thread; passar samples crus para
  um Worker contínuo é caro e ainda dependeria de timers do main thread.
- **Picovoice Porcupine (on-device)**: descartado pelo operador.
- **Mudar a CSP**: desnecessário — `worker-src 'self' blob:` (middleware.ts) já
  autoriza carregar o módulo do worklet same-origin; `'strict-dynamic'` está apenas
  em `script-src` e não governa `worker-src`.

## Consequences

**Positivas**
- Modo **mãos-livres** passa a ouvir o operador com a aba/janela trocada ou
  minimizada. Detecção mais precisa (timers por sample). Sem polling no main thread.
- Sem mudança de superfície de rede/CSP; nenhum segredo novo.

**Negativas / limites**
- O **gatilho por wake word "Ultron"** usa a Web Speech API do Chrome, que o
  próprio Chrome suspende em abas ocultas — **não** corrigido por esta decisão.
  Para uso com a janela trocada, a recomendação é mãos-livres. (Uma vez gravando, o
  auto-stop por silêncio já roda no worklet e é confiável.)
- Browsers sem AudioWorklet caem num **fallback rAF** (comportamento anterior, que
  trava em background) — sem regressão, mas sem o ganho.
- O visualizador de saída (barras durante o TTS) continua em rAF (cosmético; em
  background não anima, sem perda funcional).
- Em algumas plataformas o `AudioContext` pode suspender após muito tempo em
  background; mitigado com `ctx.resume()` no `visibilitychange`.

## Verificação

`tsc --noEmit` (o `.js` em `public/` fica fora do tsconfig), `vitest run lib/ultron`
(máquina de estados + suites existentes), e teste manual: ligar mãos-livres, trocar
de aba/janela, falar, e confirmar `POST /api/ultron/stt` no Network (prova que o VAD
rodou em background) sem violação de CSP no console.
