import "server-only";
import { env } from "@/lib/env";

const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

/**
 * Streams speech for `text` from ElevenLabs in the brand voice. Returns the raw
 * upstream Response so the caller can pipe the audio stream straight to the
 * browser (first-byte-fast → lower perceived latency).
 */
export async function synthesizeStream(text: string): Promise<Response> {
  const voiceId = env.elevenLabsVoiceId();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.elevenLabsApiKey(),
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    },
  );
  return res;
}
