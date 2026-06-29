import "server-only";
import OpenAI, { toFile } from "openai";
import { env } from "@/lib/env";

const MODEL = process.env.STT_MODEL ?? "gpt-4o-transcribe";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: env.openaiApiKey() });
  return client;
}

/** Transcribes a recorded audio blob (webm/opus) to pt-BR text. */
export async function transcribe(blob: Blob): Promise<string> {
  const file = await toFile(blob, "audio.webm", { type: blob.type || "audio/webm" });
  const res = await openai().audio.transcriptions.create({
    file,
    model: MODEL,
    language: "pt",
  });
  return (res.text ?? "").trim();
}

export type TranscriptionToken = { value: string; expiresAt: number };

/**
 * Mints a short-lived ephemeral client secret for a BROWSER realtime transcription session
 * (OpenAI Realtime, ADR 0032). The browser opens a WebSocket to OpenAI directly with this
 * token (the real `OPENAI_API_KEY` never leaves the server) and streams mic PCM live, so the
 * transcript is ~ready at end-of-speech instead of waiting for a post-speech one-shot upload.
 * Reuses `STT_MODEL` (prod: gpt-4o-mini-transcribe) so accuracy matches the one-shot path.
 */
export async function createTranscriptionToken(): Promise<TranscriptionToken> {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.openaiApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            // No `prompt`: a long vocabulary-list prompt makes the Whisper-family models echo it
            // back verbatim as the transcript on short/low-confidence audio ("prompt echo"). The
            // one-shot path never used a prompt and transcribed pt-BR cleanly, so we drop it here.
            transcription: { model: MODEL, language: "pt" },
            // server_vad endpointing tuned to MATCH our client VAD (1000ms silence) instead of
            // the 200ms default, which finalized a PARTIAL transcript on every natural mid-sentence
            // pause and truncated the utterance. 800ms keeps it slightly under the client VAD so the
            // trailing segment finalizes just before we call finish(). prefix_padding 400ms includes
            // pre-speech audio in the commit so the first word isn't clipped while the WS warms up.
            turn_detection: { type: "server_vad", silence_duration_ms: 800, prefix_padding_ms: 400 },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`realtime token failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { value: string; expires_at: number };
  return { value: data.value, expiresAt: data.expires_at };
}
