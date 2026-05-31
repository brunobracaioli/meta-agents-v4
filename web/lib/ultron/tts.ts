import "server-only";
import { env } from "@/lib/env";

// Turbo v2.5: low latency (~250-300ms) while keeping expressiveness — the "fast but
// expressive" sweet spot for a live voice assistant. Flash v2.5 is faster but flatter;
// v3 is more expressive but too slow for real-time streaming.
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

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
        // Lower stability + a touch of style = more expressive/emotive delivery;
        // speaker_boost keeps it close to the brand voice. Tuned for "fast but lively".
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    },
  );
  return res;
}
