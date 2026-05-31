#!/usr/bin/env python3
"""PreToolUse / SubagentStop hook: emit a granular agent-activity event into the
Supabase `agent_events` table so the web dashboard "live view" can mirror what the
agents are doing in real time (scraping, copy, image-gen, Meta/DB writes).

Design (mirrors remind-update-project-memory.py):
  * Fail-safe: ANY error exits 0 silently — a telemetry hook must never block or
    break a tool call / agent run.
  * Curated: only "interesting" tools become events (see _CLASSIFY). Read/Grep/Bash
    etc. are ignored to keep the feed meaningful and the run fast.
  * No PII / secrets in the payload — only action metadata.

Needs SUPABASE_URL + SUPABASE_SECRET_KEY in the environment (present on the Fly.io
runner via `fly secrets`). Inserts via the PostgREST REST endpoint with a short
timeout; on any failure it gives up quietly.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

# tool-name suffix -> (agent_name, agent_type, summary). Matched by suffix so it
# works regardless of the MCP prefix (mcp__meta-ads-mcp__ads_create_campaign, etc.).
_TOOL_MAP: list[tuple[str, tuple[str, str, str]]] = [
    ("WebFetch", ("scrape", "tool", "scraping da landing page")),
    ("WebSearch", ("pesquisa", "tool", "pesquisando na web")),
    ("ads_create_campaign", ("Meta Ads", "tool", "criando campanha")),
    ("ads_create_ad_set", ("Meta Ads", "tool", "criando conjunto de anúncios")),
    ("ads_create_ad", ("Meta Ads", "tool", "criando anúncio")),
    ("ads_create_creative", ("Meta Ads", "tool", "montando criativo")),
    ("ads_update_entity", ("Meta Ads", "tool", "atualizando entidade")),
    ("ads_activate_entity", ("Meta Ads", "tool", "ativando entidade")),
    ("ads_get_ad_entities", ("Meta Ads", "tool", "lendo entidades da conta")),
    ("ads_insights", ("Meta Ads", "tool", "lendo métricas de performance")),
    ("apply_migration", ("Banco", "tool", "aplicando migration no Supabase")),
    ("execute_sql", ("Banco", "tool", "persistindo dados no Supabase")),
]

_INGEST_TABLE = "agent_events"


def _read_event() -> dict:
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def _classify(event: dict) -> dict | None:
    """Map a hook event to an agent_events row, or None to skip."""
    hook = str(event.get("hook_event_name") or "")
    session = str(event.get("session_id") or "")[:64]

    if hook == "SubagentStop":
        name = str(event.get("subagent_type") or event.get("agent_type") or "subagent")
        return {
            "run_id": session,
            "agent_name": name,
            "agent_type": "subagent",
            "event_type": "end",
            "summary": "subagent concluído",
        }

    if hook != "PreToolUse":
        return None

    tool_name = str(event.get("tool_name") or "")
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}

    # Spawning a subagent (scrape-extractor, copywriter, image-prompt-generator…).
    if tool_name in ("Task", "Agent"):
        subtype = str(tool_input.get("subagent_type") or tool_input.get("description") or "subagent")[:80]
        return {
            "run_id": session,
            "agent_name": subtype,
            "agent_type": "subagent",
            "event_type": "start",
            "tool_name": tool_name,
            "summary": str(tool_input.get("description") or "iniciando subagent")[:200],
        }

    # Image generation runs through the image-generate skill (Skill tool) or a Bash
    # call to the generator; surface the Skill invocation.
    if tool_name == "Skill":
        skill = str(tool_input.get("skill") or "")
        if "image" in skill:
            return {
                "run_id": session,
                "agent_name": "imagem",
                "agent_type": "skill",
                "event_type": "start",
                "tool_name": tool_name,
                "summary": "gerando criativo visual",
            }
        return None

    for suffix, (agent_name, agent_type, summary) in _TOOL_MAP:
        if tool_name.endswith(suffix) or suffix in tool_name:
            return {
                "run_id": session,
                "agent_name": agent_name,
                "agent_type": agent_type,
                "event_type": "step",
                "tool_name": tool_name,
                "summary": summary,
            }
    return None


def _emit(row: dict) -> None:
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        return
    # Strip stray whitespace/CR: a secret set from a CRLF source carries a trailing \r
    # that would make the URL illegal and silently drop the event.
    base = base.strip()
    key = key.strip()
    url = f"{base.rstrip('/')}/rest/v1/{_INGEST_TABLE}"
    data = json.dumps(row).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    # Short timeout + fire-and-forget: telemetry must not slow the run noticeably.
    with urllib.request.urlopen(req, timeout=3):
        pass


def main() -> int:
    try:
        event = _read_event()
    except (ValueError, OSError):
        return 0
    try:
        row = _classify(event)
        if row is None:
            return 0
        _emit(row)
    except Exception:  # noqa: BLE001 — never break a tool call over telemetry.
        return 0
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        sys.exit(0)
