// Ultron VAD AudioWorklet processor.
//
// Runs on the real-time audio render thread, which the browser does NOT throttle
// when the tab is backgrounded (unlike requestAnimationFrame). This is what lets
// Ultron keep "hearing" the operator in hands-free mode after switching windows
// or tabs. See docs/adr/0011-ultron-vad-audioworklet.md.
//
// Plain JS on purpose: it loads via audioWorklet.addModule() and is NOT bundled
// or type-checked (lives under public/, outside tsconfig include). The pure state
// machine `createVadStateMachine` is unit-tested directly — see
// web/lib/ultron/vad-state-machine.test.ts.

// Default tuning (mirrors the authoritative constants in use-ultron-voice.ts,
// which are passed in via processorOptions; these are only a safety net).
const DEFAULTS = {
  speechRms: 0.025, // onset threshold
  silenceRms: 0.015, // below this counts as silence
  silenceMs: 900, // stop after this much trailing silence
  maxClipMs: 12000, // hard cap per utterance
  onsetDebounceMs: 50, // sustained speech required before onset (kills transients)
};

const WINDOW_SAMPLES = 1024; // ~21ms @ 48kHz — smooths per-quantum RMS

// Pure, dependency-free VAD state machine. `step(rms, dtMs)` returns null or a
// single event: { type:'speech-start' } | { type:'speech-end', reason }.
// Dormant until armed; emits at most one event per step; disarms itself on
// speech-end so the caller must re-arm for the next utterance.
function createVadStateMachine(initialConfig) {
  let cfg = Object.assign({}, DEFAULTS, initialConfig || {});
  let armed = false;
  let mode = "idle"; // "idle" (waiting for onset) | "speaking"
  let onsetAccum = 0;
  let silenceAccum = 0;
  let clipAccum = 0;

  function reset() {
    mode = "idle";
    onsetAccum = 0;
    silenceAccum = 0;
    clipAccum = 0;
  }

  return {
    arm() {
      armed = true;
      reset();
    },
    disarm() {
      armed = false;
      reset();
    },
    configure(config) {
      cfg = Object.assign({}, cfg, config || {});
    },
    // Exposed for tests/diagnostics.
    getState() {
      return { armed, mode, onsetAccum, silenceAccum, clipAccum };
    },
    step(rms, dtMs) {
      if (!armed) return null;

      if (mode === "idle") {
        if (rms > cfg.speechRms) {
          onsetAccum += dtMs;
          if (onsetAccum >= cfg.onsetDebounceMs) {
            mode = "speaking";
            onsetAccum = 0;
            silenceAccum = 0;
            clipAccum = 0;
            return { type: "speech-start" };
          }
        } else {
          onsetAccum = 0;
        }
        return null;
      }

      // mode === "speaking"
      clipAccum += dtMs;

      if (rms < cfg.silenceRms) {
        silenceAccum += dtMs;
        if (silenceAccum >= cfg.silenceMs) {
          armed = false;
          reset();
          return { type: "speech-end", reason: "silence" };
        }
      } else {
        silenceAccum = 0;
      }

      if (clipAccum >= cfg.maxClipMs) {
        armed = false;
        reset();
        return { type: "speech-end", reason: "maxclip" };
      }

      return null;
    },
  };
}

// AudioWorkletProcessor wiring. Guarded so the file can be eval'd in a plain JS
// context (tests) where these globals are stubbed.
if (typeof registerProcessor === "function") {
  class VadProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const config = (options && options.processorOptions) || {};
      this.machine = createVadStateMachine(config);
      this.acc = 0;
      this.accCount = 0;
      this.port.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "arm") this.machine.arm();
        else if (data.type === "disarm") this.machine.disarm();
        else if (data.type === "configure") this.machine.configure(data.config);
      };
    }

    process(inputs) {
      const input = inputs[0];
      const channel = input && input[0];
      if (channel) {
        for (let i = 0; i < channel.length; i++) {
          const sample = channel[i];
          this.acc += sample * sample;
          this.accCount++;
          if (this.accCount >= WINDOW_SAMPLES) {
            const rms = Math.sqrt(this.acc / this.accCount);
            const dtMs = (this.accCount / sampleRate) * 1000;
            const event = this.machine.step(rms, dtMs);
            if (event) this.port.postMessage(event);
            this.acc = 0;
            this.accCount = 0;
          }
        }
      }
      return true; // keep the processor alive
    }
  }

  registerProcessor("ultron-vad", VadProcessor);
}
