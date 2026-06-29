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

// Domain vocabulary hint biases the realtime transcription toward our jargon and client
// slug (no PII — generic terms). Helps the model get "brunobracaioli", action verbs and
// confirmation words right, which matters because activation = real spend.
const TRANSCRIPTION_PROMPT =
  "Ultron, campanha, tráfego, landing page, CTR, CPL, CPM, ROAS, funil, brunobracaioli, Meta Ads, ativar, confirmar";

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
            transcription: { model: MODEL, language: "pt", prompt: TRANSCRIPTION_PROMPT },
            turn_detection: { type: "server_vad" },
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
