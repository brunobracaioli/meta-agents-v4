import "@fontsource/share-tech-mono";

import { ArcPopoutStage } from "@/components/arc/arc-popout-stage";

export const dynamic = "force-dynamic";

// SPEC-019 Wave C.2b — the ARC second-screen window. Lives OUTSIDE /dashboard on purpose: the
// dashboard layout mounts the voice provider + console, and we must not start a second mic/voice
// session in the popout. Auth is still enforced — middleware gates /arc-popout like /dashboard.
export default function ArcPopoutPage() {
  return <ArcPopoutStage />;
}
