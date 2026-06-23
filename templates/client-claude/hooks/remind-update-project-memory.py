#!/usr/bin/env python3
"""PostToolUse hook: remind Claude to update its project memory after a
successful Meta Ads campaign *creation* or *analysis*.

Project rule (CLAUDE.md): "sempre atualize sua memoria de projeto após uma
execução bem sucedida de criação de campanha e de análise para que você
aprenda com seus resultados." The harness runs hooks, not Claude — so this
nudge is enforced here rather than relying on Claude remembering.

It listens to the deterministic success signals of the two skills:
  - the traffic-campaign skill -> `ads_create_campaign` MCP call, or a
    `*-trafego.json` run manifest is written.
  - the analysis skill -> `execute_sql` that inserts into the `analyses`
    table, or a `*-analise.json` run manifest is written.

When matched, it injects a non-blocking `additionalContext` reminder. It
de-dups per (session_id, kind) so the same run never nags twice, and it is
fail-safe: any error exits 0 silently so it can never block a tool call.

TEMPLATE (per-client workspace, ADR 0028): unlike the legacy `.claude/hooks/`
copy, this one is client-AGNOSTIC. The client label is resolved at runtime from
`CLIENT_LABEL` (env) or the workspace `client.json`, with a generic fallback —
so a scaffolded `clients/<slug>/.claude/` reminds for the right client without
editing this file.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile


def _client_label() -> str:
    """Human label for the active client (e.g. 'brunobracaioli/CCA'). Prefers
    CLIENT_LABEL; falls back to client.json's name/slug; then a generic phrase.
    Never raises — telemetry-grade best effort."""
    env = os.environ.get("CLIENT_LABEL")
    if env and env.strip():
        return env.strip()
    for path in ("client.json", ".claude/client.json"):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            label = str(data.get("name") or data.get("slug") or "").strip()
            if label:
                return label
        except (FileNotFoundError, ValueError, OSError, AttributeError):
            continue
    return "este cliente"


def _reminders(label: str) -> dict[str, str]:
    """kind -> the user-facing reminder injected back to the model (pt-BR, the
    project's working language). Kept short and actionable on purpose."""
    return {
        "creation": (
            "📝 Memória de projeto — você acabou de CRIAR/persistir uma campanha de "
            f"tráfego Meta Ads ({label}). Conforme o CLAUDE.md "
            '("sempre atualize sua memoria de projeto após uma execução bem '
            'sucedida de criação de campanha"), ao concluir a run registre o '
            "aprendizado na memória de PROJETO: decisões autônomas tomadas "
            "(geo, optimization_goal e fallbacks aplicados), erros encontrados via "
            "ads_get_errors e como foram resolvidos, e os IDs/manifest da run. "
            "Crie/atualize um arquivo memory (type=project) e adicione a linha "
            "correspondente em MEMORY.md. Headless: NÃO pergunte ao usuário — "
            "apenas registre o fato não-óbvio."
        ),
        "analysis": (
            "📝 Memória de projeto — você acabou de PERSISTIR uma análise de "
            f"performance (tabela analyses, {label}). Conforme o "
            'CLAUDE.md ("sempre atualize sua memoria de projeto após uma '
            'execução bem sucedida de análise"), ao concluir a run registre o '
            "aprendizado na memória de PROJETO: o veredito (overall_verdict), os "
            "diagnósticos relacionais que se confirmaram (quais cruzamentos de "
            "métricas), benchmarks/limitações de dados encontrados, e o que "
            "observar na próxima rodada. Crie/atualize um arquivo memory "
            "(type=project) e adicione a linha em MEMORY.md. Headless: NÃO "
            "pergunte ao usuário — apenas registre o aprendizado."
        ),
    }


# INSERT INTO [public.]analyses  (the parent table written once per round).
# `\banalyses\b` does not match `analysis_findings`, so finding inserts are
# ignored and only the round-level insert triggers the analysis reminder.
_ANALYSES_INSERT = re.compile(
    r"insert\s+into\s+(?:public\.)?analyses\b", re.IGNORECASE
)


def _read_event() -> dict:
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def _classify(tool_name: str, tool_input: dict) -> str | None:
    """Return 'creation', 'analysis', or None for the given tool call."""
    # --- Meta MCP campaign creation (prefix differs across MCP registrations,
    #     so match by suffix). ---
    if tool_name.endswith("ads_create_campaign"):
        return "creation"

    # --- Supabase: analysis round persisted. ---
    if tool_name.endswith("execute_sql"):
        query = str(tool_input.get("query") or tool_input.get("sql") or "")
        if _ANALYSES_INSERT.search(query):
            return "analysis"
        return None

    # --- Run manifest written (the skills' explicit success artifact). ---
    if tool_name == "Write":
        file_path = str(tool_input.get("file_path") or "")
        name = os.path.basename(file_path).lower()
        if not name.endswith(".json"):
            return None
        kind = (
            "creation"
            if name.endswith("-trafego.json")
            else "analysis"
            if name.endswith("-analise.json")
            else None
        )
        if kind is None:
            return None
        # Only treat a manifest as a success signal when it says so.
        if not _manifest_is_verified(tool_input.get("content")):
            return None
        return kind

    return None


def _manifest_is_verified(content) -> bool:
    """A manifest counts as success only when `verified` is truthy. If the
    content is unparseable, assume success (bias toward reminding)."""
    if not isinstance(content, str):
        return True
    try:
        return bool(json.loads(content).get("verified", True))
    except (ValueError, AttributeError):
        return True


def _state_path(session_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", session_id or "nosession")
    return os.path.join(tempfile.gettempdir(), f"claude-mem-reminder-{safe}.json")


def _already_reminded(session_id: str, kind: str) -> bool:
    """Check-and-set: True if this (session, kind) was already reminded."""
    path = _state_path(session_id)
    done: list[str] = []
    try:
        with open(path, encoding="utf-8") as fh:
            loaded = json.load(fh)
            if isinstance(loaded, list):
                done = loaded
    except (FileNotFoundError, ValueError, OSError):
        done = []

    if kind in done:
        return True

    done.append(kind)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(done, fh)
    except OSError:
        # If we can't persist state, fall through and still remind once now.
        pass
    return False


def main() -> int:
    try:
        event = _read_event()
    except (ValueError, OSError):
        return 0  # malformed stdin — never block.

    tool_name = str(event.get("tool_name") or "")
    tool_input = event.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = {}

    kind = _classify(tool_name, tool_input)
    if kind is None:
        return 0

    session_id = str(event.get("session_id") or "")
    if _already_reminded(session_id, kind):
        return 0

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": _reminders(_client_label())[kind],
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
