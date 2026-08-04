# 0035 — Barge-in por voz e Modo Reunião no chat de voz do Ultron

- Status: accepted (2026-08-04)
- Specs: SPEC-016 §16 (as-built), ADR 0011 (VAD AudioWorklet), ADR 0032 (STT streaming)

## Context

O mic nunca era mutado durante a fala do Ultron, mas o worklet de VAD se
auto-desarma no fim da fala do operador e só era rearmado depois do turno
inteiro de TTS (`restoreAfterSpeech`). Efeito: o Ultron ficava "surdo" enquanto
falava — impossível interrompê-lo por voz (só o botão ■, que ainda por cima
deixava o VAD desarmado). Também não existia nenhuma captura de áudio do
sistema: o share de tela pedia `getDisplayMedia({audio: false})`, então o Ultron
não conseguia ouvir uma call (Google Meet) para participar de uma live/gravação.

O risco central de abrir o mic durante o TTS é o **loop de auto-resposta**: o
próprio áudio do Ultron (caixa de som → mic, ou dentro da captura de tela) vira
transcript e gera nova resposta, infinitamente.

## Decision

1. **Barge-in por voz** (mãos-livres, modo worklet): o VAD permanece armado
   durante `speaking` com um perfil elevado (`BARGE_VAD_CONFIG`: 2× RMS de
   onset, 300ms sustentados, via `configure` em runtime no worklet — zero
   mudança no processor). O onset cancela o turno em streaming (extraído em
   `cancelStreamingTurn`) e abre a gravação do novo turno imediatamente.
2. **Defesa anti-eco em 3 camadas** (nenhuma sozinha basta):
   - AEC/NS/AGC explícitos no `getUserMedia` (o Chrome subtrai o playback da
     própria página do mic);
   - o perfil barge do VAD (ruído residual de caixa não abre onset);
   - filtro de texto `lib/ultron/self-echo.ts` (puro, testado): buffer das
     frases exatas faladas (12s) + containment de tokens ≥ 0.8 → transcript que
     é fragmento da fala recente do Ultron é dropado antes do chat. Única
     camada que funciona em áudio de display capture (AEC não se aplica lá).
3. **Guarda de geração de turno** (`turnGenRef`): turno novo incrementa;
   `restoreAfterSpeech(gen)` de turno atropelado vira no-op. Corrige também a
   assimetria antiga do ■ (agora restaura o modo).
4. **Modo Reunião**: `getDisplayMedia({video, audio: true})`; mic + áudio da
   guia misturados num `AudioContext` persistente
   (`MediaStreamAudioDestinationNode`); `captureStreamRef` aponta o pipeline
   inteiro (VAD, `MediaRecorder`, STT realtime) para o mix via
   `rebuildVadPipeline` — uma pipeline só, sem caminho paralelo. Gate default
   "responder só quando chamado" (`mentionsWakeName`, sequência de tokens
   normalizada) protege o rate limit do chat (20/min) em call de grupo;
   sub-toggle libera "responder a tudo". Captura recomendada = a GUIA do Meet
   (áudio da guia = só participantes remotos; o TTS do Ultron toca na aba do
   dashboard e o Meet não ecoa o mic local de volta).

## Consequences

- Operador interrompe o Ultron falando por cima (~300ms de fala sustentada);
  barulho ambiente forte pode interromper (trade-off aceito; threshold é
  ajustável em `BARGE_VAD_CONFIG`).
- O clip one-shot de um barge perde ~300ms de cabeça (debounce); o transcriber
  realtime prewarmed (ADR 0032) cobre quando a flag de streaming está ligada.
  Se prod mostrar transcripts cortados com streaming off, baixar o debounce e
  subir o RMS.
- Turnos de eco descartados aparecem como `self_echo_dropped` no console
  (score/tamanho, sem PII); barge como `barge_in_triggered`; call ignorada como
  `meet_turn_ignored` — mesmo padrão PII-free do `ultron_client_timing`.
- Modo Reunião com captura de tela/sistema inteiro inclui o TTS do Ultron na
  captura — o filtro de texto é o único backstop nesse arranjo; a UI orienta a
  capturar a guia.
- Para o Ultron ser OUVIDO na call continua fora do app: caixa de som + mic
  físico, ou cabo de áudio virtual (VB-Cable) como mic do Meet.
- Barge-in não cobre o modo wake word nem o fallback rAF nesta versão
  (follow-up documentado na SPEC-016 §16).
