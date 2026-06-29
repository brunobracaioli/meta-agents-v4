/**
 * Strips markdown / formatting markup so it is never read literally by the TTS
 * engine (otherwise "**cinquenta reais**" is spoken as "asterisco asterisco...").
 *
 * The system prompt already asks Ultron to avoid markdown (see prompt.ts), but
 * the model does not always comply. This is the deterministic guarantee applied
 * at the single choke point every spoken sentence passes through
 * (synthesizeStream in tts.ts) — defense in depth, prompt as the first layer.
 *
 * Pure function: same input → same output, no side effects.
 */
export function stripSpeechMarkup(text: string): string {
  return (
    text
      // images first (![alt](url) -> alt), then links ([label](url) -> label)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // paired emphasis (**bold**, __bold__, *italic*, _italic_, ~~strike~~) -> inner text
      .replace(/(\*\*|__|~~|\*|_)(.+?)\1/g, "$2")
      // inline code / fences: drop backticks, keep the words
      .replace(/`+/g, "")
      // line-start structural markers: headings, blockquotes, list bullets/numbers
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, "")
      // any stray, unpaired emphasis chars the model may have left behind
      .replace(/[*_`#]/g, "")
      // collapse the whitespace the removals can leave around
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .trim()
  );
}
