#!/usr/bin/env bash
# Poll the Supabase `skill_schedules` queue for due recurrences and ENQUEUE a job for each.
# Runs every minute under supercronic (see crontab). This script does NOT execute skills — it
# only enqueues agent_jobs (kind=custom); poll-agent-jobs.sh runs them. See SPEC-018 / ADR 0030.
#
# Safety:
#   * Single-flight via an atomic mkdir lock.
#   * claim_due_skill_schedule(operator) atomically picks ONE due schedule whose skill is active
#     and ADVANCES next_run_at in the same statement (FOR UPDATE SKIP LOCKED), so a schedule can
#     never double-fire between ticks. We drain up to MAX due schedules per tick.
#   * Operator-scoped: a per-operator runner (OPERATOR_ID) claims only its own schedules. With no
#     OPERATOR_ID there is nothing to scope to, so we exit (schedules are a multi-operator feature).
#   * The agent_jobs one-active-per-(client,skill) index makes a re-enqueue while a run is still in
#     flight fail cleanly — we treat that as "skip", not an error.

set -uo pipefail

LOCK_DIR="/tmp/skill-schedules-poll.lock"
MAX_PER_TICK=20
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
SUPABASE_URL="$(printf '%s' "${SUPABASE_URL}" | tr -d '[:space:]')"
SUPABASE_KEY="$(printf '%s' "${SUPABASE_KEY}" | tr -d '[:space:]')"
OPERATOR_ID="$(printf '%s' "${OPERATOR_ID:-}" | tr -d '[:space:]')"

log() { echo "SCHED $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [[ -z "${SUPABASE_URL}" || -z "${SUPABASE_KEY}" ]]; then
  log "ERROR: SUPABASE_URL / SUPABASE_SECRET_KEY not set — skipping."
  exit 0
fi
if [[ -z "${OPERATOR_ID}" ]]; then
  # Schedules are operator-scoped; a legacy single-tenant runner has nothing to claim.
  exit 0
fi

REST="${SUPABASE_URL%/}/rest/v1"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

for ((i = 0; i < MAX_PER_TICK; i++)); do
  CLAIM=$(curl -fsS -X POST "${REST}/rpc/claim_due_skill_schedule" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    --max-time 10 \
    -d "{\"p_operator_id\":\"${OPERATOR_ID}\"}" 2>/dev/null || true)

  SCHED_ID=$(printf '%s' "${CLAIM}" | jq -r '.[0].id // empty' 2>/dev/null || true)
  [[ -z "${SCHED_ID}" ]] && break

  SKILL_ID=$(printf '%s' "${CLAIM}" | jq -r '.[0].skill_id // empty')
  CLIENT_ID=$(printf '%s' "${CLAIM}" | jq -r '.[0].client_id // empty')

  # Resolve the skill slug (agent_jobs.skill is NOT NULL). If the skill vanished, skip.
  SKILL_ROW=$(curl -fsS \
    "${REST}/client_skills?id=eq.${SKILL_ID}&select=slug" \
    -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" --max-time 10 2>/dev/null || true)
  SLUG=$(printf '%s' "${SKILL_ROW}" | jq -r '.[0].slug // empty' 2>/dev/null || true)
  if [[ -z "${SLUG}" ]]; then
    log "WARN: schedule ${SCHED_ID} -> skill ${SKILL_ID} not found, skipping"
    continue
  fi

  JOB_BODY=$(jq -nc \
    --arg client_id "${CLIENT_ID}" \
    --arg operator_id "${OPERATOR_ID}" \
    --arg skill "${SLUG}" \
    --arg skill_id "${SKILL_ID}" \
    '{client_id:$client_id, operator_id:$operator_id, skill:$skill, skill_id:$skill_id, kind:"custom", args:{}, requested_by:"schedule"}')

  JOB=$(curl -fsS -X POST "${REST}/agent_jobs" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    --max-time 10 \
    -d "${JOB_BODY}" 2>/dev/null || true)
  JOB_ID=$(printf '%s' "${JOB}" | jq -r '.[0].id // empty' 2>/dev/null || true)

  if [[ -n "${JOB_ID}" ]]; then
    curl -fsS -X PATCH "${REST}/skill_schedules?id=eq.${SCHED_ID}" \
      -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" \
      --max-time 10 -d "{\"last_job_id\":\"${JOB_ID}\"}" >/dev/null 2>&1 || true
    log "enqueued job=${JOB_ID} skill=${SLUG} (schedule ${SCHED_ID})"
  else
    # Most likely the one-active-per-(client,skill) index rejected it — a prior run is still going.
    log "enqueue skipped for skill=${SLUG} (already in flight?) schedule ${SCHED_ID}"
  fi
done

exit 0
