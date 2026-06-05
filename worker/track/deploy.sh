#!/usr/bin/env bash
# Deploy headless do tagging server (ADR 0021). Mesmo mecanismo do publish de landing page:
# usa CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (sem `wrangler login`). Idempotente.
#
# Pré-requisitos (no .env.local da raiz OU já exportados no ambiente):
#   CLOUDFLARE_API_TOKEN   — com escopo: Workers Scripts:Edit, D1:Edit, Workers Routes:Edit,
#                            Zone DNS:Edit (zona b2tech.io). (Pages:Edit já tem.)
#   CLOUDFLARE_ACCOUNT_ID
#   SUPABASE_URL           — vira o secret SUPABASE_URL do Worker
#   SUPABASE_SECRET_KEY    — vira o secret SUPABASE_SERVICE_KEY do Worker (service_role)
#
# Segredos NUNCA são ecoados. Roda da pasta worker/track:  bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-../../.env.local}"
read_env() { # read_env KEY  → imprime o valor (sem CRLF/aspas); só usado em pipes, nunca logado
  local k="$1"
  if [ -n "${!k:-}" ]; then printf %s "${!k}"; return; fi
  grep -m1 "^${k}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//'
}

export CLOUDFLARE_API_TOKEN="$(read_env CLOUDFLARE_API_TOKEN | tr -d '[:space:]')"
export CLOUDFLARE_ACCOUNT_ID="$(read_env CLOUDFLARE_ACCOUNT_ID | tr -d '[:space:]')"
SUPABASE_URL_VAL="$(read_env SUPABASE_URL | tr -d '[:space:]')"
SUPABASE_KEY_VAL="$(read_env SUPABASE_SECRET_KEY | tr -d '[:space:]')"

[ -n "$CLOUDFLARE_API_TOKEN" ] || { echo "ERRO: CLOUDFLARE_API_TOKEN ausente"; exit 1; }
[ -n "$SUPABASE_URL_VAL" ] && [ -n "$SUPABASE_KEY_VAL" ] || { echo "ERRO: SUPABASE_URL/SUPABASE_SECRET_KEY ausentes"; exit 1; }

WR="npx --yes wrangler@3"
DB_NAME="lp-tracking"

echo "==> 1/5 D1: garantir o banco '$DB_NAME'"
DB_ID="$($WR d1 list --json 2>/dev/null | python3 -c "import sys,json;[print(d['uuid']) for d in json.load(sys.stdin) if d.get('name')=='$DB_NAME']" || true)"
if [ -z "$DB_ID" ]; then
  echo "    criando D1…"
  $WR d1 create "$DB_NAME" >/tmp/d1create.txt 2>&1 || { cat /tmp/d1create.txt; exit 1; }
  DB_ID="$($WR d1 list --json 2>/dev/null | python3 -c "import sys,json;[print(d['uuid']) for d in json.load(sys.stdin) if d.get('name')=='$DB_NAME']")"
fi
echo "    database_id resolvido (len=${#DB_ID})"
# injeta o database_id no wrangler.toml (idempotente)
sed -i "s/^database_id = .*/database_id = \"$DB_ID\"/" wrangler.toml

echo "==> 2/5 D1: aplicar schema.sql (remoto)"
$WR d1 execute "$DB_NAME" --file=./schema.sql --remote -y

echo "==> 3/5 Secrets do Worker (valores nunca impressos)"
printf %s "$SUPABASE_URL_VAL" | $WR secret put SUPABASE_URL
printf %s "$SUPABASE_KEY_VAL" | $WR secret put SUPABASE_SERVICE_KEY

echo "==> 4/5 Deploy"
$WR deploy

echo "==> 5/5 Validação"
sleep 3
curl -fsS "https://track.b2tech.io/healthy" && echo "  → /healthy OK" || echo "  (DNS pode levar 1-2 min p/ propagar; tente o /healthy de novo)"
echo "DONE."
