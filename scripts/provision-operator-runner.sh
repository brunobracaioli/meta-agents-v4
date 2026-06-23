#!/usr/bin/env bash
# Provision a dedicated Fly.io runner for ONE operator (ADR 0027 — runner per operator).
#
# This is run MANUALLY by a human operator, not by the queue. It creates a Fly app + volume,
# sets the runner secrets (including OPERATOR_ID, which makes the pollers claim ONLY this
# operator's jobs — see scripts/poll-agent-jobs.sh), and deploys the same Docker image. The
# runner is single-tenant from Fly's perspective: one app == one operator.
#
# Usage:
#   scripts/provision-operator-runner.sh <operator-uuid> [app-suffix]
#     <operator-uuid>  the operators.id (== auth.users.id) this runner serves
#     [app-suffix]     optional override for the app name suffix (default: first 8 hex of uuid)
#
# Env:
#   ENV_FILE   path to the secrets source (default: ./.env.local). Must contain SUPABASE_URL,
#              SUPABASE_SECRET_KEY and OPENAI_API_KEY.
#   FLY_ORG    Fly org to create the app in (default: personal).
#   FLY_REGION primary region (default: gru).
#
# AFTER this script: the runner still needs the operator's Claude OAuth + connectors seeded
# ONCE, interactively (they live on the volume, never in env/secrets):
#   fly ssh console -a <app> -C claude        # complete the OAuth login
#   then connect Meta Ads / Google Ads at https://claude.ai/customize/connectors
# Until then run-skill.sh exits 3 ("Claude OAuth not seeded").
#
# Idempotent: re-running skips an existing app/volume and just re-sets secrets + redeploys.

set -euo pipefail

OPERATOR_ID="${1:?usage: provision-operator-runner.sh <operator-uuid> [app-suffix]}"
ENV_FILE="${ENV_FILE:-./.env.local}"
FLY_ORG="${FLY_ORG:-personal}"
FLY_REGION="${FLY_REGION:-gru}"

# Validate the operator uuid before it touches an app name or a SQL filter.
if ! [[ "${OPERATOR_ID}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "ERROR: '<operator-uuid>' is not a UUID: ${OPERATOR_ID}" >&2
  exit 2
fi

# App name: meta-agents-op-<suffix>. Fly app names are [a-z0-9-]; derive from the uuid by default.
SUFFIX="${2:-${OPERATOR_ID:0:8}}"
SUFFIX="$(printf '%s' "${SUFFIX}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
APP="meta-agents-op-${SUFFIX}"

command -v fly >/dev/null 2>&1 || { echo "ERROR: flyctl ('fly') not found in PATH." >&2; exit 3; }
fly auth whoami >/dev/null 2>&1 || { echo "ERROR: not logged in — run 'fly auth login' first." >&2; exit 3; }
[[ -f "${ENV_FILE}" ]] || { echo "ERROR: ENV_FILE not found: ${ENV_FILE}" >&2; exit 3; }

# Read one KEY from ENV_FILE, stripping CR and surrounding quotes (the Fly secret-sync gotcha:
# a value carrying \r or quotes silently breaks the runner's curl/URL handling).
read_env() {
  local key="$1" line val
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  val="${line#*=}"
  val="$(printf '%s' "${val}" | tr -d '\r')"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "${val}"
}

SUPABASE_URL="$(read_env SUPABASE_URL)"
SUPABASE_SECRET_KEY="$(read_env SUPABASE_SECRET_KEY)"
OPENAI_API_KEY="$(read_env OPENAI_API_KEY)"
for v in SUPABASE_URL SUPABASE_SECRET_KEY OPENAI_API_KEY; do
  [[ -n "${!v}" ]] || { echo "ERROR: ${v} missing/empty in ${ENV_FILE}" >&2; exit 3; }
done

echo "==> Provisioning runner '${APP}' for operator ${OPERATOR_ID} (region ${FLY_REGION}, org ${FLY_ORG})"

# 1) App (idempotent).
if fly apps list 2>/dev/null | awk '{print $1}' | grep -qx "${APP}"; then
  echo "    app ${APP} already exists — reusing."
else
  fly apps create "${APP}" --org "${FLY_ORG}"
fi

# 2) Volume for Claude OAuth + connector state (mounted at /home/runner/.claude per fly.toml).
if fly volumes list -a "${APP}" 2>/dev/null | grep -q 'claude_state'; then
  echo "    volume claude_state already exists — reusing."
else
  fly volumes create claude_state -a "${APP}" -r "${FLY_REGION}" -s 1 --yes
fi

# 3) Secrets (idempotent set; OPERATOR_ID is what flips the runner into scoped-claim mode).
fly secrets set -a "${APP}" \
  SUPABASE_URL="${SUPABASE_URL}" \
  SUPABASE_SECRET_KEY="${SUPABASE_SECRET_KEY}" \
  OPENAI_API_KEY="${OPENAI_API_KEY}" \
  OPERATOR_ID="${OPERATOR_ID}"

# 4) Deploy the same image, overriding the app name from fly.toml.
fly deploy -a "${APP}" --config fly.toml --dockerfile Dockerfile --strategy immediate

# 5) Record the app on the operator row (best-effort; non-fatal).
REST="${SUPABASE_URL%/}/rest/v1"
curl -fsS -X PATCH "${REST}/operators?id=eq.${OPERATOR_ID}" \
  -H "apikey: ${SUPABASE_SECRET_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  --max-time 10 \
  -d "{\"fly_app_name\":\"${APP}\",\"runner_status\":\"provisioned\"}" >/dev/null 2>&1 \
  || echo "    WARN: could not update operators.${OPERATOR_ID} (fly_app_name/runner_status)"

cat <<EOF

==> Runner '${APP}' deployed.

NEXT (manual, one-time — seeds the operator's Claude credentials on the volume):
  fly ssh console -a ${APP} -C claude          # complete the OAuth login flow
  # then, in the operator's own claude.ai account, connect the custom connectors:
  #   Meta Ads + Google Ads at https://claude.ai/customize/connectors
  # and flip operators.connectors_status / runner_status='ready' once verified.

Until OAuth is seeded, run-skill.sh exits 3 and no job runs. Logs: fly logs -a ${APP}
EOF
