#!/usr/bin/env bash
# PID-1 inside the Fly Machine. Boots supercronic which then schedules the
# campaign runner. See docs/specs/flyio-cron-campaign-runner.md §3.4.

set -euo pipefail

CLAUDE_CRED="/home/runner/.claude/.credentials.json"

if [[ ! -f "${CLAUDE_CRED}" ]]; then
  cat <<'EOF' >&2
WARN: Claude Code OAuth credentials are NOT seeded.
The cron will fail until you run, ONCE, from the host:

  fly ssh console -a meta-agents-v4
  > claude        # follow the OAuth flow; close after success
  > exit

Tokens persist on the claude_state volume.
EOF
fi

# -passthrough-logs forwards each job's stdout/stderr to our stdout (captured
# by `fly logs`). supercronic does not overlap a job with itself by default.
exec supercronic -passthrough-logs /app/crontab
