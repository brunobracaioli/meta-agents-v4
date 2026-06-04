#!/usr/bin/env bash
# Poll the Supabase `autonomous_watches` queue for one "due" watch and run a tick of the
# autonomous-mode skill on it. Runs every minute under supercronic (see crontab), alongside
# poll-agent-jobs.sh but with its OWN lock so the two never block each other.
#
# What a tick does (the LLM skill autonomous-watch-tick, ADR 0019 / SPEC-013): read the
# watched agent_job + its agent_events, narrate the progress into `ultron_narrations` (which the
# operator's browser polls + speaks), and advance the watch's phase. The browser is a separate
# process (Vercel), so narration travels through Postgres — never an inbound webhook (ADR 0001).
#
# Safety / design:
#   * Single-flight via an atomic mkdir lock — a long tick makes the next ticks no-op.
#   * `claim_autonomous_watch` claims one DUE watch atomically (updated_at older than the ~90s
#     cadence; FOR UPDATE SKIP LOCKED) and bumps updated_at so it isn't re-claimed this cadence.
#   * A tick failure is NON-fatal: the watch stays active and is simply retried next cadence
#     (unlike agent_jobs, there is no stuck-'claimed' state to rescue). The skill itself is
#     responsible for terminal transitions (done/failed) and for timing out a stalled job.
#   * AGENT_JOB_ID is set to the watch id when invoking the skill purely to suppress run-skill's
#     lifecycle agent_events (the tick must not pollute the live view) — see run-skill.sh.

set -uo pipefail

LOCK_DIR="/tmp/autonomous-watch-poll.lock"
WORKER_ID="${FLY_MACHINE_ID:-$(hostname)}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

# Strip stray whitespace/CR — a secret set from a CRLF source carries a trailing \r that makes
# the URL illegal (`curl: (3) bad/illegal format`) and silently breaks polling.
SUPABASE_URL="$(printf '%s' "${SUPABASE_URL}" | tr -d '[:space:]')"
SUPABASE_KEY="$(printf '%s' "${SUPABASE_KEY}" | tr -d '[:space:]')"

log() { echo "WATCH-POLL $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [[ -z "${SUPABASE_URL}" || -z "${SUPABASE_KEY}" ]]; then
  log "ERROR: SUPABASE_URL / SUPABASE_SECRET_KEY not set — skipping."
  exit 0
fi

REST="${SUPABASE_URL%/}/rest/v1"

cleanup() { rmdir "${LOCK_DIR}" 2>/dev/null || true; }

# Single-flight: if the lock exists, a previous tick is still running — bail quietly.
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  exit 0
fi
trap cleanup EXIT

# Claim the oldest due watch atomically.
CLAIM=$(curl -fsS -X POST "${REST}/rpc/claim_autonomous_watch" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 10 \
  -d "{\"p_worker_id\":\"${WORKER_ID}\"}" 2>/dev/null)

if [[ -z "${CLAIM}" ]]; then
  log "claim request returned nothing (transient) — will retry next tick."
  exit 0
fi

WATCH_ID=$(echo "${CLAIM}" | jq -r '.[0].id // empty')
if [[ -z "${WATCH_ID}" ]]; then
  # No due watches.
  exit 0
fi

# Defence in depth: the claimed id must be a uuid before it reaches the shell as an arg.
if ! [[ "${WATCH_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  log "ERROR: claimed watch id is not a uuid: '${WATCH_ID}'"
  exit 0
fi

PHASE=$(echo "${CLAIM}" | jq -r '.[0].phase // empty')
log "claimed watch=${WATCH_ID} phase=${PHASE} — running a tick"

# AGENT_JOB_ID set to the watch id ONLY to suppress run-skill.sh lifecycle events for the tick.
RUN_LOG=$(mktemp)
AGENT_JOB_ID="${WATCH_ID}" /app/scripts/run-skill.sh autonomous-watch-tick "watch_id=${WATCH_ID}" >"${RUN_LOG}" 2>&1
EC=$?

if [[ ${EC} -eq 0 ]]; then
  log "watch=${WATCH_ID} tick ok"
else
  # Non-fatal: keep a short tail for debugging; the watch is retried next cadence.
  log "watch=${WATCH_ID} tick exited ${EC}: $(tail -n 1 "${RUN_LOG}" | tr -d '\r' | cut -c1-300)"
fi
rm -f "${RUN_LOG}"
exit 0
