#!/usr/bin/env python3
"""PreToolUse hook: restringe WebFetch/WebSearch a domínios de documentação oficial.

Lê a allowlist de .claude/research-allowlist.txt (fonte única de verdade) e NEGA
qualquer WebFetch para domínio fora da lista, ou qualquer WebSearch que não declare
allowed_domains contido na lista. Roda mesmo sob --dangerously-skip-permissions
(hooks são independentes do sistema de permissions), por isso é a camada que de fato
protege a automação headless deste projeto.

Fail-closed: se a allowlist não puder ser lida, nega (não abre a porta por engano).
"""
from __future__ import annotations

import json
import os
import sys
from urllib.parse import urlparse

ALLOWLIST_REL = os.path.join(".claude", "research-allowlist.txt")


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def allow_pass() -> None:
    # Silêncio + exit 0 == não interfere; outros hooks (telemetria) seguem.
    sys.exit(0)


def load_allowlist(project_dir: str) -> set[str]:
    path = os.path.join(project_dir, ALLOWLIST_REL)
    with open(path, encoding="utf-8") as fh:
        return {
            line.strip().lower()
            for line in fh
            if line.strip() and not line.lstrip().startswith("#")
        }


def host_allowed(host: str | None, allow: set[str]) -> bool:
    if not host:
        return False
    host = host.lower().split(":")[0].rstrip(".")
    # Casamento por fronteira de ponto: "facebook.com" cobre "x.facebook.com"
    # mas NÃO "evil-facebook.com".
    return any(host == d or host.endswith("." + d) for d in allow)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        allow_pass()  # input malformado não é WebFetch/WebSearch; não bloqueia outros tools
        return

    tool = data.get("tool_name", "")
    if tool not in ("WebFetch", "WebSearch"):
        allow_pass()
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or "."
    try:
        allow = load_allowlist(project_dir)
    except OSError as exc:
        deny(f"research-allowlist não pôde ser lida ({exc}); negando por segurança (fail-closed).")
        return

    if not allow:
        deny("research-allowlist está vazia; negando por segurança (fail-closed).")
        return

    tool_input = data.get("tool_input", {}) or {}

    if tool == "WebFetch":
        url = tool_input.get("url", "")
        if not host_allowed(urlparse(url).hostname, allow):
            deny(
                f"Domínio fora do research-allowlist: {url or '(vazio)'}. "
                "Permitido apenas documentação oficial listada em "
                ".claude/research-allowlist.txt."
            )
        allow_pass()

    # WebSearch: exige allowed_domains não-vazio e ⊆ allowlist, senão a busca
    # traria snippets de domínios arbitrários para o contexto.
    allowed_domains = tool_input.get("allowed_domains") or []
    if not allowed_domains:
        deny(
            "WebSearch exige o parâmetro allowed_domains restrito ao research-allowlist "
            "(.claude/research-allowlist.txt). Passe allowed_domains com os domínios oficiais."
        )
    bad = [d for d in allowed_domains if not host_allowed(d, allow)]
    if bad:
        deny(f"allowed_domains fora do research-allowlist: {bad}.")
    allow_pass()


if __name__ == "__main__":
    main()
