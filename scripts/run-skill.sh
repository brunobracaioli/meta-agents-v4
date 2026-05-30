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

if [[ ! -f "${SKILL_DIR}/SKILL.md" ]]; then
  echo "ERROR: skill not found at ${SKILL_DIR}/SKILL.md" >&2
  exit 2
fi

if [[ ! -f "${CLAUDE_CRED}" ]]; then
  echo "ERROR: ${CLAUDE_CRED} missing — Claude OAuth not seeded." >&2
  echo "       Run 'claude' interactively once via 'fly ssh console'." >&2
  exit 3
fi

mkdir -p /var/log/runs
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/var/log/runs/${TS}-${SKILL}.log"

cd /app

echo "RUN_START skill=${SKILL} prompt='${PROMPT}' log=${LOG} ts=${TS} timeout=${RUN_TIMEOUT_SEC}s"

set +e
timeout "${RUN_TIMEOUT_SEC}" claude -p --dangerously-skip-permissions \
  "${PROMPT}" 2>&1 \
  | tee "${LOG}"
EC=${PIPESTATUS[0]}
set -e

echo "RUN_RESULT skill=${SKILL} exit=${EC} log=${LOG}"
exit "${EC}"
