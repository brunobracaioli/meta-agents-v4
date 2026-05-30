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
