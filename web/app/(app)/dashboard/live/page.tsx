import { LiveFeed } from "@/components/live/live-feed";

export const dynamic = "force-dynamic";

// Real-time agent activity, via server-side polling of jobs, lifecycle, and events.
export default function LivePage() {
  return <LiveFeed />;
}
