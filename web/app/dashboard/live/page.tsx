import { LiveFeed } from "@/components/live/live-feed";

export const dynamic = "force-dynamic";

// Real-time mirror of agent activity (agent_events), via server-side polling.
export default function LivePage() {
  return <LiveFeed />;
}
