import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Load the *shipped* worklet file and extract its pure state machine, so the test
// exercises the real code (no duplication). The processor-registration block is
// skipped because we don't provide `registerProcessor` in the sandbox.
const WORKLET_PATH = fileURLToPath(new URL("../../public/ultron/vad-processor.js", import.meta.url));

type VadEvent = { type: "speech-start" } | { type: "speech-end"; reason: "silence" | "maxclip" };
type Machine = {
  arm: () => void;
  disarm: () => void;
  configure: (c: Record<string, number>) => void;
  getState: () => { armed: boolean; mode: string };
  step: (rms: number, dtMs: number) => VadEvent | null;
};
type Factory = (config?: Record<string, number>) => Machine;

function loadFactory(): Factory {
  const code = readFileSync(WORKLET_PATH, "utf8");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(code, sandbox);
  const factory = sandbox.createVadStateMachine as Factory | undefined;
  if (!factory) throw new Error("createVadStateMachine not found in worklet file");
  return factory;
}

const CONFIG = {
  speechRms: 0.025,
  silenceRms: 0.015,
  silenceMs: 900,
  maxClipMs: 12_000,
  onsetDebounceMs: 50,
};

// Feed a sequence of [rms, dtMs, repeat?] steps and collect emitted events.
function run(machine: Machine, steps: Array<[number, number, number?]>): VadEvent[] {
  const events: VadEvent[] = [];
  for (const [rms, dt, repeat = 1] of steps) {
    for (let i = 0; i < repeat; i++) {
      const event = machine.step(rms, dt);
      if (event) events.push(event);
    }
  }
  return events;
}

describe("vad state machine", () => {
  const factory = loadFactory();

  it("emits nothing while dormant (not armed)", () => {
    const m = factory(CONFIG);
    const events = run(m, [[0.5, 20, 100]]); // loud, but never armed
    expect(events).toEqual([]);
  });

  it("ignores continuous low-level noise", () => {
    const m = factory(CONFIG);
    m.arm();
    const events = run(m, [[0.005, 20, 200]]);
    expect(events).toEqual([]);
  });

  it("does not fire onset on a sub-debounce transient", () => {
    const m = factory(CONFIG);
    m.arm();
    // 40ms of speech (< 50ms debounce) then back to silence.
    const events = run(m, [
      [0.05, 20, 2],
      [0.005, 20, 50],
    ]);
    expect(events).toEqual([]);
    expect(m.getState().mode).toBe("idle");
  });

  it("fires speech-start after sustained onset, then speech-end on trailing silence", () => {
    const m = factory(CONFIG);
    m.arm();
    const events = run(m, [
      [0.05, 20, 3], // 60ms >= 50ms debounce -> onset on 3rd step
      [0.05, 100, 5], // keep speaking
      [0.005, 100, 9], // 900ms of silence -> endpoint
    ]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", reason: "silence" }]);
    // self-disarms after speech-end
    expect(m.getState().armed).toBe(false);
  });

  it("fires speech-end with reason maxclip when speech never stops", () => {
    const m = factory(CONFIG);
    m.arm();
    const events = run(m, [
      [0.05, 20, 3], // onset
      [0.05, 100, 120], // 12_000ms of continuous speech -> maxclip
    ]);
    expect(events).toEqual([{ type: "speech-start" }, { type: "speech-end", reason: "maxclip" }]);
  });

  it("requires re-arm for the next utterance", () => {
    const m = factory(CONFIG);
    m.arm();
    run(m, [
      [0.05, 20, 3],
      [0.005, 100, 9],
    ]);
    // disarmed now: loud input produces nothing
    expect(run(m, [[0.05, 20, 5]])).toEqual([]);
    // re-arm and it detects again
    m.arm();
    const events = run(m, [[0.05, 20, 3]]);
    expect(events).toEqual([{ type: "speech-start" }]);
  });
});
