// Client-side conversation session id, persisted in localStorage so it survives reloads AND
// is shared across tabs of the same origin. This matters for the operator-present flows that
// key off the session: autonomous-mode narrations and the live-review trigger are written for
// a specific session, and a per-tab id (sessionStorage) silently broke delivery whenever the
// operator opened a second tab or reopened the dashboard. For a single-operator console one
// shared memory window across tabs is the desirable behaviour.
const KEY = "ultron_session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
    if (!id) {
      // Migrate an existing per-tab id if present, so an in-flight session isn't orphaned.
      id = sessionStorage.getItem(KEY) ?? crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
  } catch {
    // Storage blocked (private mode / 3rd-party context): fall back to an ephemeral id.
    id = crypto.randomUUID();
  }
  return id;
}
