import "@fontsource/share-tech-mono";

import { ArcStage } from "@/components/arc/arc-stage";

export const dynamic = "force-dynamic";

// SPEC-019 — ARC holographic interface ("Tony Stark Mode"). Opt-in fullscreen route that
// reuses the shared Ultron voice/narration/vision pipeline; the classic dashboard is left
// untouched as a rollback surface. Thin server shell — all behavior lives in <ArcStage />.
export default function ArcPage() {
  return <ArcStage />;
}
