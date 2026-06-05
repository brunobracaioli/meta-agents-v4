import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// One-shot vision for the Ultron Live Review (SPEC-014, Surface A). Given a single screen
// frame of one landing-page section plus its label, returns 1–2 spoken sentences in pt-BR
// (brand voice) that the orchestrator feeds to TTS. Unlike the chat loop this is stateless:
// no tools, no memory, no resume — just describe-and-opine on the frame in front of it.

const MODEL = process.env.ULTRON_REVIEW_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = 220;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return client;
}

const SYSTEM_PROMPT =
  "Você é o Ultron, diretor de criação da B2 Tech, revisando uma landing page AO VIVO com o " +
  "operador presente (a fala vai virar áudio). Recebe UM print de UMA seção por vez, com o " +
  "rótulo da seção. Comente em 1–2 frases curtas, em português do Brasil, com a voz da marca: " +
  "direto, confiante, técnico e cinematográfico. Avalie hierarquia visual, clareza da promessa " +
  "e do CTA, e o impacto. Se o rótulo indicar a abertura 3D, comente o impacto cinematográfico " +
  "da cena. Fale como quem narra em voz alta: sem markdown, sem listas, sem prefixos como " +
  "'Análise:'. Nunca descreva que é uma captura de tela — fale da seção em si.";

export type ReviewFrameImage = {
  media_type: "image/jpeg" | "image/png" | "image/webp";
  data: string; // base64, no data: prefix
};

export async function analyzeReviewFrame(input: {
  image: ReviewFrameImage;
  label: string;
}): Promise<string> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: input.image.media_type, data: input.image.data },
          },
          { type: "text", text: `Seção atual: ${input.label}. Comente em 1–2 frases.` },
        ],
      },
    ],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}
