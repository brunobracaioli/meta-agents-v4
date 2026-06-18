import "server-only";
import { db } from "@/lib/db/client";
import { getReadClient } from "@/lib/db/read-client";

/**
 * Server→browser narration channel for Ultron's autonomous mode (ADR 0019). The headless
 * watch-tick skill inserts rows into `ultron_narrations`; the operator's tab polls these and
 * speaks them via the existing TTS. We follow ADR 0007's pattern (polling + service key,
 * RLS stays deny-by-default) instead of Supabase Realtime.
 */

export type PendingNarration = {
  id: string;
  text: string;
  kind: string;
  image_path: string | null;
  ts: string;
};

// Ignore anything older than this so a tab reopened much later does not replay ancient
// narrations. Recent backlog (operator stepped away briefly) is still spoken.
const MAX_AGE_MS = 60 * 60 * 1000; // 1h
const MAX_BATCH = 10;

/** Unspoken narrations for a browser session, oldest first. */
export async function getPendingNarrations(sessionId: string): Promise<PendingNarration[]> {
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const supabase = await getReadClient();
  const { data, error } = await supabase
    .from("ultron_narrations")
    .select("id, text, kind, image_path, ts")
    .eq("session_id", sessionId)
    .is("spoken_at", null)
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(MAX_BATCH);
  if (error) throw error;
  return data ?? [];
}

/** Mark a narration spoken so it is not replayed. Idempotent. */
export async function markNarrationSpoken(id: string): Promise<void> {
  const { error } = await db()
    .from("ultron_narrations")
    .update({ spoken_at: new Date().toISOString() })
    .eq("id", id)
    .is("spoken_at", null);
  if (error) throw error;
}
