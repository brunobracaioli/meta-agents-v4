#!/usr/bin/env bash
# Scaffold (or refresh) a per-client Claude workspace at clients/<slug>/.claude/ from the
# templates/client-claude/ skeleton + the client's own skills/materials (ADR 0028, Phase 5).
#
# Usage: scripts/scaffold-client-workspace.sh <slug>
#   Env: ENV_FILE (default ./.env.local) — must hold SUPABASE_URL + SUPABASE_SECRET_KEY.
#
# What it does (idempotent — safe to re-run):
#   * COPIES the generic skeleton (settings, agents, hooks, research-allowlist, generic skills)
#     from templates/client-claude/ — the single source of truth for the generic parts.
#   * RENDERS client.json from client.json.tmpl with values read from the `clients` row.
#   * SYMLINKS the client's operational skills (.claude/skills/*-<slug>*) + the global registries
#     + the client's materials tree — so there is no second copy to drift.
#
# Output (clients/<slug>/) is generated + gitignored; the truth lives in the template,
# .claude/skills/ and .claude/materiais-das-empresas/. Nothing here touches the live runner.

set -euo pipefail

SLUG="${1:?usage: scaffold-client-workspace.sh <slug>}"
ENV_FILE="${ENV_FILE:-./.env.local}"

if ! [[ "${SLUG}" =~ ^[a-z0-9-]{2,40}$ ]]; then
  echo "ERROR: slug must match ^[a-z0-9-]{2,40}$ (got: ${SLUG})" >&2
  exit 2
fi

# Resolve repo root from this script's location so it works from any cwd.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

TEMPLATE="templates/client-claude"
CANON_SKILLS=".claude/skills"
CANON_MATERIALS=".claude/materiais-das-empresas/${SLUG}"
OUT="clients/${SLUG}/.claude"

[[ -d "${TEMPLATE}" ]] || { echo "ERROR: template not found: ${TEMPLATE}" >&2; exit 3; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required." >&2; exit 3; }
[[ -f "${ENV_FILE}" ]] || { echo "ERROR: ENV_FILE not found: ${ENV_FILE}" >&2; exit 3; }

# Read one KEY from ENV_FILE, stripping CR and surrounding quotes (Fly secret-sync gotcha).
read_env() {
  local key="$1" line val
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  val="${line#*=}"
  val="$(printf '%s' "${val}" | tr -d '\r')"
  val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  printf '%s' "${val}"
}

SUPABASE_URL="$(read_env SUPABASE_URL | tr -d '[:space:]')"
SUPABASE_KEY="$(read_env SUPABASE_SECRET_KEY | tr -d '[:space:]')"
[[ -n "${SUPABASE_URL}" && -n "${SUPABASE_KEY}" ]] || {
  echo "ERROR: SUPABASE_URL / SUPABASE_SECRET_KEY missing in ${ENV_FILE}" >&2; exit 3; }

# Resolve the client row from the DB (the source of business constants).
echo "==> Resolving client '${SLUG}' from the clients table"
SELECT="slug,name,ad_account_id,business_manager_id,facebook_page_id,default_landing_url,daily_budget_cap_cents,currency,materials_path"
ROW="$(curl -fsS \
  "${SUPABASE_URL%/}/rest/v1/clients?slug=eq.${SLUG}&select=${SELECT}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  --max-time 15)"
COUNT="$(printf '%s' "${ROW}" | jq 'length')"
[[ "${COUNT}" == "1" ]] || { echo "ERROR: expected 1 clients row for slug='${SLUG}', got ${COUNT}" >&2; exit 4; }
get() { printf '%s' "${ROW}" | jq -r ".[0].${1} // empty"; }

NAME="$(get name)"
AD_ACCOUNT_ID="$(get ad_account_id)"
BUSINESS_MANAGER_ID="$(get business_manager_id)"
FACEBOOK_PAGE_ID="$(get facebook_page_id)"
DEFAULT_LANDING_URL="$(get default_landing_url)"
DAILY_BUDGET_CAP_CENTS="$(get daily_budget_cap_cents)"
CURRENCY="$(get currency)"
MATERIALS_PATH="$(get materials_path)"
[[ "${DAILY_BUDGET_CAP_CENTS}" =~ ^[0-9]+$ ]] || DAILY_BUDGET_CAP_CENTS=0

# 1) Generic skeleton: copy from the template (overwrite on re-run — template is the truth).
echo "==> Copying generic skeleton into ${OUT}"
rm -rf "${OUT}"
mkdir -p "${OUT}/skills"
cp "${TEMPLATE}/settings.json" "${OUT}/settings.json"
cp "${TEMPLATE}/research-allowlist.txt" "${OUT}/research-allowlist.txt" 2>/dev/null || true
cp -r "${TEMPLATE}/agents" "${OUT}/agents"
cp -r "${TEMPLATE}/hooks" "${OUT}/hooks"
for s in "${TEMPLATE}"/skills/*/; do
  [[ -d "${s}" ]] && cp -r "${s}" "${OUT}/skills/$(basename "${s}")"
done

# 2) Render client.json from the template, substituting the DB values.
echo "==> Rendering client.json"
cp "${TEMPLATE}/client.json.tmpl" "${OUT}/client.json"
render() {  # render <TOKEN> <value> — escape sed-special chars in the replacement
  local token="$1" value="$2" esc
  esc="$(printf '%s' "${value}" | sed -e 's/[\\&|]/\\&/g')"
  sed -i "s|{{${token}}}|${esc}|g" "${OUT}/client.json"
}
render CLIENT_SLUG "${SLUG}"
render CLIENT_NAME "${NAME}"
render AD_ACCOUNT_ID "${AD_ACCOUNT_ID}"
render BUSINESS_MANAGER_ID "${BUSINESS_MANAGER_ID}"
render FACEBOOK_PAGE_ID "${FACEBOOK_PAGE_ID}"
render DEFAULT_LANDING_URL "${DEFAULT_LANDING_URL}"
render DAILY_BUDGET_CAP_CENTS "${DAILY_BUDGET_CAP_CENTS}"
render CURRENCY "${CURRENCY}"
render MATERIALS_PATH "${MATERIALS_PATH}"
jq . "${OUT}/client.json" >/dev/null || { echo "ERROR: rendered client.json is not valid JSON" >&2; exit 5; }

# 3) Symlink the client's operational skills + the global registries (no copy -> no drift).
#    Relative target from clients/<slug>/.claude/skills/<name> back to repo-root .claude/skills/<name>.
echo "==> Linking operational skills"
link_skill() {  # link_skill <skill-dir-name>
  local name="$1"
  [[ -d "${CANON_SKILLS}/${name}" ]] || return 0
  ln -sfn "../../../../.claude/skills/${name}" "${OUT}/skills/${name}"
  echo "    + ${name}"
}
op_count=0
for d in "${CANON_SKILLS}"/*-"${SLUG}"*/; do
  [[ -d "${d}" ]] || continue
  link_skill "$(basename "${d}")"; op_count=$((op_count + 1))
done
for reg in lista-de-clientes lista-de-produtos; do link_skill "${reg}"; done
if [[ "${op_count}" -eq 0 ]]; then
  echo "    WARN: no operational skills matched '.claude/skills/*-${SLUG}*' — a new client needs its own skills authored."
fi

# 4) Symlink the client's materials tree (relative target, mirrors the skills layout).
echo "==> Linking materials"
if [[ -d "${CANON_MATERIALS}" ]]; then
  mkdir -p "${OUT}/materiais-das-empresas"
  ln -sfn "../../../../.claude/materiais-das-empresas/${SLUG}" "${OUT}/materiais-das-empresas/${SLUG}"
  echo "    + materiais-das-empresas/${SLUG}"
else
  echo "    WARN: no materials at ${CANON_MATERIALS} — author the client's logo/refs-canonicas/produtos there."
fi

cat <<EOF

==> Workspace ready: ${OUT}
    client.json: ${NAME} (${SLUG}) · ad_account ${AD_ACCOUNT_ID} · budget ${DAILY_BUDGET_CAP_CENTS} ${CURRENCY}
    operational skills linked: ${op_count}
This tree is generated + gitignored. Re-run anytime to refresh from the template / canonical sources.
The runner (run-skill.sh) uses it automatically once OPERATOR_ID + a matching clients/<slug>/.claude exist.
EOF
