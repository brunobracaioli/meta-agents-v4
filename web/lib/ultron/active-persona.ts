import type { PersonaId } from "./prompt";

// Client-side runtime signal for "which avatar persona is active right now". The shared voice
// hook (useUltronVoice) is mounted by the dashboard layout, ABOVE and beside the ARC's rig
// state, so it can't read the selection via props/context. The ARC mirrors its selected rig
// here (and resets to "ultron" on unmount), and the voice hook reads it when building each
// chat/tts request body — so the persona/voice is scoped to the ARC being mounted+selected.
//
// `import type { PersonaId }` is erased at build time, so this stays a browser-only module and
// pulls no server-only code (the prompt text) into the client bundle.
let active: PersonaId = "ultron";

export function setActivePersona(persona: PersonaId): void {
  active = persona;
}

export function getActivePersona(): PersonaId {
  return active;
}
