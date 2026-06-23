import "@fontsource/share-tech-mono";

import { UltronStage } from "@/components/ultron-3d/ultron-stage";

export const dynamic = "force-dynamic";

// 3D Ultron avatar that lip-syncs to the live TTS audio. Voice controls live in the
// floating console (UltronWidget), wired through the shared UltronProvider.
export default function UltronPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-2xl font-semibold uppercase tracking-[0.14em] text-white">Ultron</h1>
        <p className="mt-1 text-sm text-white/40">
          Fale com o Ultron pelo console flutuante — o avatar reage e move a boca quando ele responde.
        </p>
      </div>
      <UltronStage />
    </div>
  );
}
