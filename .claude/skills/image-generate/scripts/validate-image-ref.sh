#!/usr/bin/env bash
# validate-image-ref.sh
# Valida uma imagem de referência ANTES de ela ser passada a um subagent
# (Anthropic Vision) ou à OpenAI images API.
#
# Uso:
#   validate-image-ref.sh <path>
#
# Saída (stdout, uma linha):
#   OK <bytes> <mime>                                  → exit 0
#   SKIP <warning_code> <path>[:<detail>]              → exit 1
#
# Regras (espelham o Step 1.5 do agent image-prompt-generator):
#   - arquivo precisa existir e ser regular
#   - 200 B <= tamanho <= 1.000.000 B (1 MB)
#   - mime (magic bytes) em {image/png, image/jpeg, image/webp}

set -uo pipefail

MIN_BYTES=200
MAX_BYTES=1000000

PATH_ARG="${1:?usage: validate-image-ref.sh <path>}"

if [[ -d "$PATH_ARG" ]]; then
  echo "SKIP reference_path_is_dir ${PATH_ARG}"
  exit 1
fi

if [[ ! -f "$PATH_ARG" ]]; then
  echo "SKIP reference_path_not_found ${PATH_ARG}"
  exit 1
fi

BYTES=$(wc -c < "$PATH_ARG" | tr -d '[:space:]')

if (( BYTES < MIN_BYTES )); then
  echo "SKIP reference_skipped_invalid_size ${PATH_ARG}:${BYTES}"
  exit 1
fi

if (( BYTES > MAX_BYTES )); then
  echo "SKIP reference_skipped_too_large ${PATH_ARG}:${BYTES}"
  exit 1
fi

MIME=$(file --brief --mime-type "$PATH_ARG" 2>/dev/null || echo "unknown")

case "$MIME" in
  image/png|image/jpeg|image/webp)
    echo "OK ${BYTES} ${MIME}"
    exit 0
    ;;
  *)
    echo "SKIP reference_skipped_invalid_magic ${PATH_ARG}:${MIME}"
    exit 1
    ;;
esac
