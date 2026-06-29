// PCM capture worklet for realtime STT (ADR 0032). Runs in a dedicated 24kHz AudioContext
// (the browser resamples the mic for us), converts each render quantum of mono Float32 to
// PCM16 little-endian, and posts it to the main thread, which batches and base64-sends it
// over the OpenAI Realtime WebSocket. Pure capture — no VAD here (the existing vad-processor
// stays the source of truth for endpointing/visualizer; OpenAI's server_vad finalizes the
// transcript). Kept tiny on purpose: the heavy lifting (batching, base64, WS) is main-thread.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Transfer the buffer (zero-copy) to the main thread.
      this.port.postMessage(pcm, [pcm.buffer]);
    }
    return true; // keep the processor alive for the whole utterance
  }
}
registerProcessor("ultron-pcm-capture", PcmCaptureProcessor);
