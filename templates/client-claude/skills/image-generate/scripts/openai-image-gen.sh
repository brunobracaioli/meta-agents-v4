#!/usr/bin/env bash
# openai-image-gen.sh
# Gera 1 imagem via OpenAI gpt-image-2 (state-of-the-art, ADR 0015).
#
# Uso:
#   openai-image-gen.sh <PROMPT> <SIZE> <OUTPUT_PATH> [REF1 REF2 ... REF16]
#
#   PROMPT       — texto descritivo (obrigatório)
#   SIZE         — "1024x1024" | "1024x1536" | "1536x1024"
#   OUTPUT_PATH  — onde salvar o PNG resultante
#   REF1..REF16  — (opcional) paths de imagens de referência (logo, mascote,
#                  foto de produto). gpt-image-2 aceita até 16 imagens via
#                  image[]= no multipart. Se nenhuma ref for passada, usa
#                  /v1/images/generations (text-only). Se 1+ refs forem passadas,
#                  usa /v1/images/edits com os arquivos como referência.
#
# Requer env: OPENAI_API_KEY (e opcional OPENAI_ORG_ID).
# Modelo: gpt-image-2 alias (snapshot atual: gpt-image-2-2026-04-21).
#
# BREAKING CHANGE vs v1: assinatura mudou de
#   openai-image-gen.sh PROMPT SIZE LOGO_PATH OUTPUT_PATH
# para
#   openai-image-gen.sh PROMPT SIZE OUTPUT_PATH [REF1 REF2 ...]
# Callers antigos que passavam LOGO_PATH no $3 precisam ser atualizados.

set -euo pipefail

PROMPT="${1:?missing prompt}"
SIZE="${2:?missing size}"
OUTPUT_PATH="${3:?missing output path}"
shift 3

# Tudo que restar são refs (pode ser zero)
REF_PATHS=("$@")

: "${OPENAI_API_KEY:?OPENAI_API_KEY is required}"

# Validação do size
case "$SIZE" in
  1024x1024|1024x1536|1536x1024) ;;
  *) echo "ERROR: unsupported size $SIZE" >&2; exit 1 ;;
esac

# Validação dos arquivos de referência
VALID_REFS=()
for REF in "${REF_PATHS[@]}"; do
  if [[ -f "$REF" && -s "$REF" ]]; then
    VALID_REFS+=("$REF")
  else
    echo "WARN: ref not found or empty, skipping: $REF" >&2
  fi
done

if [[ ${#VALID_REFS[@]} -gt 16 ]]; then
  echo "WARN: gpt-image-2 aceita no máximo 16 refs; usando as primeiras 16." >&2
  VALID_REFS=("${VALID_REFS[@]:0:16}")
fi

# On Git Bash / MSYS, mingw64 curl precisa de paths Windows-style para @file.
to_curl_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    echo "$1"
  fi
}

ORG_HEADER=()
if [[ -n "${OPENAI_ORG_ID:-}" ]]; then
  ORG_HEADER=(-H "OpenAI-Organization: ${OPENAI_ORG_ID}")
fi

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

# ────────────────────────────────────────────────────────────────────────────
# Roteamento: com refs → /v1/images/edits  |  sem refs → /v1/images/generations
# ────────────────────────────────────────────────────────────────────────────

if [[ ${#VALID_REFS[@]} -gt 0 ]]; then
  # ── EDITS (com imagens de referência) ────────────────────────────────────
  # Monta -F "image[]=@<path>" pra cada ref válida.
  REF_ARGS=()
  for REF in "${VALID_REFS[@]}"; do
    REF_CURL_PATH=$(to_curl_path "$REF")
    REF_ARGS+=(-F "image[]=@${REF_CURL_PATH}")
  done

  echo "INFO: usando /v1/images/edits com ${#VALID_REFS[@]} ref(s)." >&2

  curl -sS -f --http1.1 https://api.openai.com/v1/images/edits \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    "${ORG_HEADER[@]}" \
    "${REF_ARGS[@]}" \
    -F "model=gpt-image-2" \
    -F "prompt=${PROMPT}" \
    -F "size=${SIZE}" \
    -F "quality=high" \
    -F "n=1" \
    -o "$RESPONSE_FILE"

else
  # ── GENERATIONS (só texto, sem refs) ─────────────────────────────────────
  echo "INFO: nenhuma ref válida — usando /v1/images/generations (text-only)." >&2

  curl -sS -f --http1.1 https://api.openai.com/v1/images/generations \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    "${ORG_HEADER[@]}" \
    -d "$(node -e "
      process.stdout.write(JSON.stringify({
        model: 'gpt-image-2',
        prompt: process.argv[1],
        size: process.argv[2],
        quality: 'high',
        n: 1,
        output_format: 'png'
      }));
    " "$PROMPT" "$SIZE")" \
    -o "$RESPONSE_FILE"
fi

# ────────────────────────────────────────────────────────────────────────────
# Extrai base64 → arquivo final (sem dependência de jq)
# ────────────────────────────────────────────────────────────────────────────
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const b64 = r?.data?.[0]?.b64_json;
if (!b64) {
  console.error("ERROR: missing data[0].b64_json in response:");
  console.error(JSON.stringify(r).slice(0, 800));
  process.exit(1);
}
fs.writeFileSync(process.argv[2], Buffer.from(b64, "base64"));
' "$RESPONSE_FILE" "$OUTPUT_PATH"

# Sanity check
if [[ ! -s "$OUTPUT_PATH" ]]; then
  echo "ERROR: output file is empty: $OUTPUT_PATH" >&2
  exit 1
fi

echo "OK: $OUTPUT_PATH ($(wc -c < "$OUTPUT_PATH") bytes)"