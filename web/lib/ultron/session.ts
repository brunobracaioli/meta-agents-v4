// Client-side conversation session id (one sliding-memory window per browser tab).
const KEY = "ultron_session_id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
