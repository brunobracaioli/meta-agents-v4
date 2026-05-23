#!/usr/bin/env bash
# Fly exec health check. See docs/specs/flyio-cron-campaign-runner.md §3.7.
# Exit 0 = healthy, non-zero = Fly restarts the Machine.

set -euo pipefail

# 1. Claude Code CLI is callable
claude --version >/dev/null

# 2. crontab parses cleanly
supercronic -test /app/crontab >/dev/null 2>&1

# 3. OAuth must be seeded — but allow a 5-minute grace window after the
#    volume's first mount so the operator has time to run `claude` interactively.
CRED="/home/runner/.claude/.credentials.json"
if [[ ! -f "${CRED}" ]]; then
  VOL_DIR="/home/runner/.claude"
  if [[ -d "${VOL_DIR}" ]]; then
    NOW=$(date +%s)
    MTIME=$(stat -c %Y "${VOL_DIR}" 2>/dev/null || echo "${NOW}")
    AGE_MIN=$(( (NOW - MTIME) / 60 ))
    if (( AGE_MIN > 5 )); then
      echo "FAIL: ${CRED} missing after ${AGE_MIN}min — run 'claude' via fly ssh." >&2
      exit 1
    fi
  fi
fi

exit 0
