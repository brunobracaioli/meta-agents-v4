#!/usr/bin/env bash
# Thin wrapper around `claude -p` for headless skill execution from cron.
# See docs/specs/flyio-cron-campaign-runner.md §3.6.
#
# Usage: run-skill.sh <skill-name> [arg=value ...]
#   e.g. run-skill.sh create-traffic-brunobracaioli-campaign
#        run-skill.sh activate-campaign-brunobracaioli campaign_meta_id=120246500174380505
#
# Optional trailing args are appended to the skill prompt verbatim (the poller passes
# the job's `args` this way). Callers MUST pass only safe key=value tokens.

set -euo pipefail

SKILL="${1:?usage: run-skill.sh <skill-name> [arg=value ...]}"
shift || true
SKILL_DIR="/app/.claude/skills/${SKILL}"
CLAUDE_CRED="/home/runner/.claude/.credentials.json"
RUN_TIMEOUT_SEC="${RUN_TIMEOUT_SEC:-1500}"

PROMPT=".claude/skills/${SKILL}"
if [[ $# -gt 0 ]]; then
  PROMPT="${PROMPT} $*"
fi

mkdir -p /var/log/runs
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/var/log/runs/${TS}-${SKILL}.log"
RUN_ID="${AGENT_RUN_ID:-${TS}-${SKILL}}"
SUPABASE_URL_CLEAN="$(printf '%s' "${SUPABASE_URL:-}" | tr -d '[:space:]')"
SUPABASE_KEY="$(printf '%s' "${SUPABASE_SECRET_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}" | tr -d '[:space:]')"

emit_lifecycle() {
  local event_type="$1" summary="$2" exit_code="${3:-}"
  local body

  # Jobs already expose durable process state through `agent_jobs`; lifecycle rows
  # are for direct cron/manual run-skill.sh executions that bypass the queue.
  if [[ -n "${AGENT_JOB_ID:-}" ]]; then
    return 0
  fi
  if [[ -z "${SUPABASE_URL_CLEAN}" || -z "${SUPABASE_KEY}" ]]; then
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    return 0
  fi

  if ! body="$(jq -nc \
    --arg run_id "${RUN_ID}" \
    --arg skill "${SKILL}" \
    --arg event_type "${event_type}" \
    --arg summary "${summary}" \
    --arg prompt "${PROMPT}" \
    --arg log "${LOG}" \
    --arg exit_code "${exit_code}" \
    '{
      run_id: $run_id,
      agent_name: $skill,
      agent_type: "skill",
      event_type: $event_type,
      tool_name: "run-skill.sh",
      summary: $summary,
      payload: {
        skill: $skill,
        prompt: $prompt,
        log: $log
      } + (if $exit_code == "" then {} else {exit_code: ($exit_code | tonumber)} end)
    }'
  )"; then
    return 0
  fi

  curl -fsS -X POST "${SUPABASE_URL_CLEAN%/}/rest/v1/agent_events" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --max-time 3 \
    -d "${body}" >/dev/null 2>&1 || true
}

emit_lifecycle "start" "skill iniciada"

if [[ ! -f "${SKILL_DIR}/SKILL.md" ]]; then
  echo "ERROR: skill not found at ${SKILL_DIR}/SKILL.md" >&2
  emit_lifecycle "error" "skill not found at ${SKILL_DIR}/SKILL.md" "2"
  exit 2
fi

if [[ ! -f "${CLAUDE_CRED}" ]]; then
  echo "ERROR: ${CLAUDE_CRED} missing — Claude OAuth not seeded." >&2
  echo "       Run 'claude' interactively once via 'fly ssh console'." >&2
  emit_lifecycle "error" "Claude OAuth credentials missing" "3"
  exit 3
fi

cd /app

echo "RUN_START skill=${SKILL} prompt='${PROMPT}' log=${LOG} ts=${TS} timeout=${RUN_TIMEOUT_SEC}s"

# Emit per-tool telemetry by parsing claude's stream-json output. Settings-file
# hooks do NOT fire in headless `-p` mode (anthropics/claude-code#40506), so we
# tap the output stream instead — see scripts/emit-from-stream.py. PIPESTATUS[0]
# keeps the skill's own exit code despite the parser/tee in the pipeline.
set +e
timeout "${RUN_TIMEOUT_SEC}" claude -p --dangerously-skip-permissions \
  --output-format stream-json --verbose \
  "${PROMPT}" 2>&1 \
  | python3 /app/scripts/emit-from-stream.py \
  | tee "${LOG}"
EC=${PIPESTATUS[0]}
set -e

echo "RUN_RESULT skill=${SKILL} exit=${EC} log=${LOG}"
if [[ ${EC} -eq 0 ]]; then
  emit_lifecycle "end" "skill concluída" "${EC}"
else
  emit_lifecycle "error" "skill falhou com exit ${EC}" "${EC}"
fi
exit "${EC}"
