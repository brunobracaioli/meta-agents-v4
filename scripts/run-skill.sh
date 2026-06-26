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
# Default: single-tenant baked workspace. A per-operator runner with a per-client tree
# (Phase 5) overrides WORKSPACE_ROOT below after validating ownership.
WORKSPACE_ROOT="/app"
SKILL_DIR="${WORKSPACE_ROOT}/.claude/skills/${SKILL}"
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

# Per-operator isolation (ADR 0027). When this runner is dedicated to an operator (OPERATOR_ID
# set) AND the job carries a client (AGENT_JOB_CLIENT_ID, exported by the poller), verify the
# client belongs to THIS operator before running anything — the third barrier of the
# multi-operator threat model (the scoped claim should already prevent it; this is defence in
# depth, fail-closed). With no OPERATOR_ID (legacy single-tenant runner) the block is skipped
# and behavior is byte-for-byte the current one.
OPERATOR_ID_CLEAN="$(printf '%s' "${OPERATOR_ID:-}" | tr -d '[:space:]')"
CLIENT_ID_CLEAN="$(printf '%s' "${AGENT_JOB_CLIENT_ID:-}" | tr -d '[:space:]')"
if [[ -n "${OPERATOR_ID_CLEAN}" && -n "${CLIENT_ID_CLEAN}" ]]; then
  # `|| true`: a transient REST failure leaves CLIENT_ROW empty, which fails the check below
  # (fail-closed) instead of aborting under `set -e` before we can emit a clean error event.
  CLIENT_ROW="$(curl -fsS \
    "${SUPABASE_URL_CLEAN%/}/rest/v1/clients?id=eq.${CLIENT_ID_CLEAN}&select=operator_id,slug" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    --max-time 10 2>/dev/null || true)"
  [[ -n "${CLIENT_ROW}" ]] || CLIENT_ROW="[]"
  # `2>/dev/null || true`: never let a parse hiccup abort under `set -e` — an empty result
  # falls through to the mismatch check below (fail-closed).
  CLIENT_OPERATOR_ID="$(printf '%s' "${CLIENT_ROW}" | jq -r '.[0].operator_id // empty' 2>/dev/null || true)"
  CLIENT_SLUG="$(printf '%s' "${CLIENT_ROW}" | jq -r '.[0].slug // empty' 2>/dev/null || true)"
  if [[ "${CLIENT_OPERATOR_ID}" != "${OPERATOR_ID_CLEAN}" ]]; then
    echo "ERROR: client ${CLIENT_ID_CLEAN} not owned by operator ${OPERATOR_ID_CLEAN} — refusing" >&2
    emit_lifecycle "error" "client não pertence a este operador" "3"
    exit 3
  fi
  # Use the per-client workspace once it has been scaffolded (Phase 5); otherwise fall back to
  # the baked /app tree, so this stays a no-op until per-client workspaces exist.
  if [[ -n "${CLIENT_SLUG}" && -d "/app/clients/${CLIENT_SLUG}/.claude" ]]; then
    WORKSPACE_ROOT="/app/clients/${CLIENT_SLUG}"
    SKILL_DIR="${WORKSPACE_ROOT}/.claude/skills/${SKILL}"
  fi
fi

# SPEC-018: operator-authored skill (ADR 0030). If the skill isn't baked on disk and the job
# carries a skill_id, materialize an EPHEMERAL SKILL.md from client_skills before running — reusing
# the existing claude -p path. `body` is plain instructions; `allowed_tools` becomes the frontmatter
# allow-list. The slug must match what the poller passed (defence in depth).
SKILL_ID_CLEAN="$(printf '%s' "${AGENT_JOB_SKILL_ID:-}" | tr -d '[:space:]')"
if [[ ! -f "${SKILL_DIR}/SKILL.md" && -n "${SKILL_ID_CLEAN}" ]]; then
  if [[ -z "${SUPABASE_URL_CLEAN}" || -z "${SUPABASE_KEY}" ]] || ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: cannot materialize custom skill (missing Supabase env or jq)" >&2
    emit_lifecycle "error" "materialização de skill custom indisponível" "2"
    exit 2
  fi
  SKILL_ROW="$(curl -fsS \
    "${SUPABASE_URL_CLEAN%/}/rest/v1/client_skills?id=eq.${SKILL_ID_CLEAN}&select=slug,name,description,body,allowed_tools" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    --max-time 10 2>/dev/null || true)"
  [[ -n "${SKILL_ROW}" ]] || SKILL_ROW="[]"
  DB_SLUG="$(printf '%s' "${SKILL_ROW}" | jq -r '.[0].slug // empty' 2>/dev/null || true)"
  if [[ -z "${DB_SLUG}" ]]; then
    echo "ERROR: custom skill ${SKILL_ID_CLEAN} not found in DB" >&2
    emit_lifecycle "error" "skill custom não encontrada no banco" "2"
    exit 2
  fi
  if [[ "${DB_SLUG}" != "${SKILL}" ]]; then
    echo "ERROR: skill slug mismatch (job='${SKILL}' db='${DB_SLUG}') — refusing" >&2
    emit_lifecycle "error" "slug da skill diverge do banco" "3"
    exit 3
  fi
  mkdir -p "${SKILL_DIR}"
  # Frontmatter: name/description JSON-encoded (valid YAML double-quoted scalars, safe with colons);
  # allowed-tools is a comma-join of a safe-charset token list. Body is written raw after.
  {
    printf -- '---\n'
    printf 'name: %s\n' "$(printf '%s' "${SKILL_ROW}" | jq -r '(.[0].name // .[0].slug) | tojson')"
    printf 'description: %s\n' "$(printf '%s' "${SKILL_ROW}" | jq -r '((.[0].description // "") | gsub("[\n\r]";" ")) | tojson')"
    printf 'allowed-tools: %s\n' "$(printf '%s' "${SKILL_ROW}" | jq -r '(.[0].allowed_tools // []) | join(", ")')"
    printf -- '---\n\n'
  } > "${SKILL_DIR}/SKILL.md"
  printf '%s' "${SKILL_ROW}" | jq -r '.[0].body' >> "${SKILL_DIR}/SKILL.md"
  echo "MATERIALIZED custom skill ${DB_SLUG} from DB -> ${SKILL_DIR}/SKILL.md"
fi

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

cd "${WORKSPACE_ROOT}"

echo "RUN_START skill=${SKILL} workspace=${WORKSPACE_ROOT} prompt='${PROMPT}' log=${LOG} ts=${TS} timeout=${RUN_TIMEOUT_SEC}s"

# Emit per-tool telemetry by parsing claude's stream-json output — the parser is
# the source of truth for tool events here: unlike the PreToolUse hook matcher, it
# also sees connector-prefixed MCP tools (mcp__claude_ai_Meta_Ads_MCP__…). Current
# CLIs DO fire settings-file hooks in `-p` mode (the old #40506 limitation is gone),
# so AGENT_EVENTS_FROM_STREAM=1 tells emit-agent-event.py to skip PreToolUse and
# only emit SubagentStop "end" rows, which the stream has no signal for — without
# it every Task/WebFetch/Skill event lands twice. PIPESTATUS[0] keeps the skill's
# own exit code despite the parser/tee in the pipeline.
export AGENT_EVENTS_FROM_STREAM=1
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
