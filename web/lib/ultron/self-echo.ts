/**
 * Text-level self-echo defense for barge-in and Meet mode. The client knows the
 * exact sentences Ultron just spoke (they flow through the TTS sentence queue), so
 * when a fresh transcript arrives we can ask: is this the operator, or is it
 * Ultron's own voice coming back through the speakers / a captured tab?
 *
 * This is the LAST of three layers (browser AEC and the raised barge VAD profile
 * run first) and the only one that works on display-captured audio, where AEC
 * does not apply. Pure + synchronous so it is unit-testable without a browser.
 */

export type SpokenEntry = { text: string; at: number };

export type SpokenBufferOptions = { windowMs?: number; maxEntries?: number };
export type SelfEchoOptions = { threshold?: number; minTokens?: number; windowMs?: number };

// How long a spoken sentence stays eligible as an echo source. STT of an echo lands
// within a couple of seconds of playback; 12s covers a long sentence plus the
// trailing-silence VAD window with margin.
const DEFAULT_WINDOW_MS = 12_000;
const DEFAULT_MAX_ENTRIES = 12;
// Fraction of transcript tokens that must appear in the recently spoken text. An
// echo is a (possibly garbled) FRAGMENT of what Ultron said, so containment of the
// transcript in the spoken text beats symmetric similarity.
const DEFAULT_THRESHOLD = 0.8;
// Below this many tokens, containment is too easy to hit by accident ("tá", "sim"
// must never be eaten) — short transcripts require an exact substring match instead.
const DEFAULT_MIN_TOKENS = 3;

/** Lowercase, strip diacritics (pt-BR) and punctuation, split into tokens. */
export function normalizeSpeech(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Appends a spoken sentence and prunes expired/overflowing entries. Returns a new array. */
export function pushSpoken(
  entries: SpokenEntry[],
  text: string,
  now: number,
  opts?: SpokenBufferOptions,
): SpokenEntry[] {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const next = entries.filter((e) => now - e.at <= windowMs);
  if (text.trim()) next.push({ text, at: now });
  return next.slice(-maxEntries);
}

/**
 * True when the transcript looks like a fragment of what Ultron recently said.
 * Token containment against the multiset of recent spoken tokens; short transcripts
 * fall back to exact normalized substring matching.
 */
export function isSelfEcho(
  transcript: string,
  entries: SpokenEntry[],
  now: number,
  opts?: SelfEchoOptions,
): boolean {
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const minTokens = opts?.minTokens ?? DEFAULT_MIN_TOKENS;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;

  const recent = entries.filter((e) => now - e.at <= windowMs);
  if (recent.length === 0) return false;

  const transcriptTokens = normalizeSpeech(transcript);
  if (transcriptTokens.length === 0) return false;

  if (transcriptTokens.length < minTokens) {
    const needle = transcriptTokens.join(" ");
    return recent.some((e) => normalizeSpeech(e.text).join(" ").includes(needle));
  }

  // Multiset of spoken tokens: each occurrence can absorb one transcript token, so a
  // transcript that repeats a word more often than Ultron did scores lower.
  const spokenCounts = new Map<string, number>();
  for (const entry of recent) {
    for (const token of normalizeSpeech(entry.text)) {
      spokenCounts.set(token, (spokenCounts.get(token) ?? 0) + 1);
    }
  }

  let found = 0;
  for (const token of transcriptTokens) {
    const count = spokenCounts.get(token) ?? 0;
    if (count > 0) {
      found++;
      spokenCounts.set(token, count - 1);
    }
  }
  return found / transcriptTokens.length >= threshold;
}

/**
 * True when the transcript contains one of the given names as a consecutive token
 * sequence (normalized). Multi-token names ("t 800") match as a sequence, so
 * "T-800, cria a campanha" hits but "800 reais" alone does not trip a single-token
 * name. Used by Meet mode's "respond only when addressed" gate.
 */
export function mentionsWakeName(transcript: string, names: string | string[]): boolean {
  const transcriptTokens = normalizeSpeech(transcript);
  if (transcriptTokens.length === 0) return false;
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const nameTokens = normalizeSpeech(name);
    if (nameTokens.length === 0) continue;
    outer: for (let i = 0; i <= transcriptTokens.length - nameTokens.length; i++) {
      for (let j = 0; j < nameTokens.length; j++) {
        if (transcriptTokens[i + j] !== nameTokens[j]) continue outer;
      }
      return true;
    }
  }
  return false;
}
