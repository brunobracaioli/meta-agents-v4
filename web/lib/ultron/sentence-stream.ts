/**
 * Incremental sentence splitter for streaming TTS. As Claude streams text deltas,
 * we want to start synthesizing/speaking each sentence the moment it completes —
 * instead of waiting for the whole reply. Push deltas; get back any sentences that
 * are now complete; flush the remainder when the stream ends.
 *
 * Pure + synchronous so it is unit-testable without a browser or network.
 */

// Soft cap: if the model emits a long run with no terminator (rare, e.g. a URL or a
// list without punctuation), flush at the last whitespace so the first audio is not
// held hostage to a missing period.
const SOFT_CAP = 180;

// A boundary is a sentence-ending mark FOLLOWED by whitespace (so "R$ 1.500" or
// "3.14" never splits — there is no space after the dot), or a newline.
const TERMINATORS = new Set([".", "!", "?", "…"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r";
}

export class SentenceAccumulator {
  private buf = "";

  /** Append a delta and return any sentences that just became complete. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];

    for (;;) {
      const idx = this.findBoundary();
      if (idx === -1) break;
      const sentence = this.buf.slice(0, idx + 1).trim();
      this.buf = this.buf.slice(idx + 1).replace(/^\s+/, "");
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** Return whatever is left (the final, unterminated sentence), or null. */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest.length > 0 ? rest : null;
  }

  // Index of the character that ends the first complete sentence, or -1.
  private findBoundary(): number {
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i]!;
      if (ch === "\n") return i;
      if (TERMINATORS.has(ch)) {
        const next = this.buf[i + 1];
        // Need to SEE the following whitespace to commit — this is what keeps
        // decimals/abbreviations from splitting mid-token at the buffer's edge.
        if (next !== undefined && isWhitespace(next)) return i;
      }
    }
    // No real boundary: honor the soft cap so a punctuation-less run still starts
    // speaking. Split at the last whitespace before the cap.
    if (this.buf.length >= SOFT_CAP) {
      const slice = this.buf.slice(0, SOFT_CAP);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > 0) return lastSpace - 1; // boundary char is the word's last char
    }
    return -1;
  }
}
