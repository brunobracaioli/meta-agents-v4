#!/usr/bin/env bash
# Poll the Supabase `agent_jobs` queue for one pending job and run it.
# Runs every minute under supercronic (see crontab). The web app (Ultron) enqueues
# jobs; this is the worker that executes them on the Fly.io runner — the only host
# with the Meta MCP + Claude OAuth. See docs/specs/ultron-agent-trigger.md and
# docs/adr/0009-on-demand-agent-jobs-queue.md.
#
# Safety:
#   * Single-flight via an atomic mkdir lock — a long run (up to RUN_TIMEOUT_SEC)
#     makes the next ticks no-op instead of stacking concurrent skills.
#   * `claim_agent_job` RPC claims one row atomically (FOR UPDATE SKIP LOCKED).
#   * The skill name is re-validated here (charset + on-disk) as defence in depth;
#     args are charset-restricted before being passed to the shell.
#   * Fail-safe: any unexpected exit marks an in-flight job 'failed' (EXIT trap),
#     so a crash never leaves a job stuck 'claimed' forever (it would block the
#     one-job-per-(client,kind) index).

set -uo pipefail

LOCK_DIR="/tmp/agent-jobs-poll.lock"
WORKER_ID="${FLY_MACHINE_ID:-$(hostname)}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"

CURRENT_JOB_ID=""
FINALIZED=""

log() { echo "POLL $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [[ -z "${SUPABASE_URL}" || -z "${SUPABASE_KEY}" ]]; then
  log "ERROR: SUPABASE_URL / SUPABASE_SECRET_KEY not set — skipping."
  exit 0
fi

REST="${SUPABASE_URL%/}/rest/v1"

# PATCH a job row. Args: <id> <json-body>
patch_job() {
  local id="$1" body="$2"
  curl -fsS -X PATCH "${REST}/agent_jobs?id=eq.${id}" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --max-time 10 \
    -d "${body}" >/dev/null 2>&1 || log "WARN: patch job ${id} failed"
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Mark an in-flight job failed if we exit before finalizing it (crash/timeout).
cleanup() {
  local ec=$?
  if [[ -n "${CURRENT_JOB_ID}" && -z "${FINALIZED}" ]]; then
    patch_job "${CURRENT_JOB_ID}" "{\"status\":\"failed\",\"finished_at\":\"$(now_iso)\",\"error\":\"poller exited unexpectedly (code ${ec})\"}"
  fi
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}

# Single-flight: if the lock exists, a previous run is still working — bail quietly.
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  exit 0
fi
trap cleanup EXIT

# Claim the oldest pending job atomically.
CLAIM=$(curl -fsS -X POST "${REST}/rpc/claim_agent_job" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 10 \
  -d "{\"p_worker_id\":\"${WORKER_ID}\"}" 2>/dev/null)

if [[ -z "${CLAIM}" ]]; then
  log "claim request returned nothing (transient) — will retry next tick."
  exit 0
fi

JOB_ID=$(echo "${CLAIM}" | jq -r '.[0].id // empty')
if [[ -z "${JOB_ID}" ]]; then
  # No pending jobs.
  exit 0
fi

CURRENT_JOB_ID="${JOB_ID}"
SKILL=$(echo "${CLAIM}" | jq -r '.[0].skill // empty')
KIND=$(echo "${CLAIM}" | jq -r '.[0].kind // empty')
ARGS=$(echo "${CLAIM}" | jq -r '.[0].args | to_entries | map("\(.key)=\(.value)") | join(" ")')

# Defence in depth: validate the skill name and that it exists on disk.
if ! [[ "${SKILL}" =~ ^[a-z0-9-]+$ ]] || [[ ! -f "/app/.claude/skills/${SKILL}/SKILL.md" ]]; then
  log "ERROR: job ${JOB_ID} has invalid/unknown skill '${SKILL}'"
  patch_job "${JOB_ID}" "{\"status\":\"failed\",\"finished_at\":\"$(now_iso)\",\"error\":\"unknown skill: ${SKILL}\"}"
  FINALIZED=1
  exit 0
fi

# Restrict arg tokens to a safe charset (no shell metacharacters) before word-splitting.
if [[ -n "${ARGS}" ]] && ! [[ "${ARGS}" =~ ^[A-Za-z0-9_.:/=\ -]*$ ]]; then
  log "ERROR: job ${JOB_ID} has unsafe args"
  patch_job "${JOB_ID}" "{\"status\":\"failed\",\"finished_at\":\"$(now_iso)\",\"error\":\"unsafe args rejected\"}"
  FINALIZED=1
  exit 0
fi

log "claimed job=${JOB_ID} kind=${KIND} skill=${SKILL} args='${ARGS}'"
patch_job "${JOB_ID}" "{\"status\":\"running\",\"started_at\":\"$(now_iso)\"}"

# Run the skill. `${ARGS}` is intentionally unquoted to split into key=value words;
# it was charset-validated above, so this is safe.
RUN_LOG=$(mktemp)
# shellcheck disable=SC2086
/app/scripts/run-skill.sh "${SKILL}" ${ARGS} >"${RUN_LOG}" 2>&1
EC=$?

if [[ ${EC} -eq 0 ]]; then
  log "job=${JOB_ID} completed"
  patch_job "${JOB_ID}" "{\"status\":\"completed\",\"finished_at\":\"$(now_iso)\",\"exit_code\":0}"
else
  # Keep a short, sanitized error tail (last line) for the dashboard / Ultron.
  ERR_TAIL=$(tail -n 1 "${RUN_LOG}" | tr -d '\r' | jq -Rs '.[0:500]')
  log "job=${JOB_ID} failed exit=${EC}"
  patch_job "${JOB_ID}" "{\"status\":\"failed\",\"finished_at\":\"$(now_iso)\",\"exit_code\":${EC},\"error\":${ERR_TAIL}}"
fi
FINALIZED=1
rm -f "${RUN_LOG}"
exit 0
