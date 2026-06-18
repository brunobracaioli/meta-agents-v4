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

# tool-name substring -> (agent_name, agent_type, summary). Matched by suffix/substring so
# it works regardless of the MCP prefix. Two connector generations coexist here: the old
# `ads_*` names (mcp__claude_ai_Meta_Ads_MCP__ads_create_campaign) and the new
# MCP_META_ADS_B2_TECH names without the `ads_` prefix (…__create_campaign, …__create_ad).
# ORDER MATTERS: matching returns the FIRST hit, and `create_ad` ⊂ `create_adset`
# (idem update_/pause_/list_) — keep the *_adset / *_campaign / *_creative entries BEFORE
# the *_ad entry, or an ad-set call would be mislabelled as an ad.
_TOOL_MAP: list[tuple[str, tuple[str, str, str]]] = [
    ("WebFetch", ("scrape", "tool", "scraping da landing page")),
    ("WebSearch", ("pesquisa", "tool", "pesquisando na web")),
    # old MCP (Meta_Ads_MCP, ads_*)
    ("ads_create_campaign", ("Meta Ads", "tool", "criando campanha")),
    ("ads_create_ad_set", ("Meta Ads", "tool", "criando conjunto de anúncios")),
    ("ads_create_ad", ("Meta Ads", "tool", "criando anúncio")),
    ("ads_create_creative", ("Meta Ads", "tool", "montando criativo")),
    ("ads_update_entity", ("Meta Ads", "tool", "atualizando entidade")),
    ("ads_activate_entity", ("Meta Ads", "tool", "ativando entidade")),
    ("ads_get_ad_entities", ("Meta Ads", "tool", "lendo entidades da conta")),
    ("ads_insights", ("Meta Ads", "tool", "lendo métricas de performance")),
    # new MCP (MCP_META_ADS_B2_TECH) — *_adset before *_ad (substring), etc.
    ("create_campaign", ("Meta Ads", "tool", "criando campanha")),
    ("create_creative", ("Meta Ads", "tool", "montando criativo")),
    ("create_adset", ("Meta Ads", "tool", "criando conjunto de anúncios")),
    ("create_ad", ("Meta Ads", "tool", "criando anúncio")),
    ("update_campaign", ("Meta Ads", "tool", "atualizando campanha")),
    ("update_adset", ("Meta Ads", "tool", "atualizando conjunto de anúncios")),
    ("update_ad", ("Meta Ads", "tool", "atualizando anúncio")),
    ("pause_campaign", ("Meta Ads", "tool", "pausando campanha")),
    ("pause_adset", ("Meta Ads", "tool", "pausando conjunto de anúncios")),
    ("pause_ad", ("Meta Ads", "tool", "pausando anúncio")),
    ("list_campaigns", ("Meta Ads", "tool", "lendo campanhas")),
    ("list_adsets", ("Meta Ads", "tool", "lendo conjuntos de anúncios")),
    ("list_creatives", ("Meta Ads", "tool", "lendo criativos")),
    ("list_ads", ("Meta Ads", "tool", "lendo anúncios")),
    ("run_insights_report", ("Meta Ads", "tool", "lendo métricas de performance")),
    ("get_insights", ("Meta Ads", "tool", "lendo métricas de performance")),
    ("apply_migration", ("Banco", "tool", "aplicando migration no Supabase")),
    ("execute_sql", ("Banco", "tool", "persistindo dados no Supabase")),
]

_INGEST_TABLE = "agent_events"


def _run_id(session: str) -> str:
    """Queued jobs export AGENT_JOB_ID (poll-agent-jobs.sh); stamping it links the
    event to its job run — same rule as scripts/emit-from-stream.py. Without it,
    hook events land under the Claude session id, an orphan run no dashboard query
    joins back to the job. Direct cron/manual runs keep the session id as before."""
    return (os.environ.get("AGENT_JOB_ID") or "").strip() or session


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
            "run_id": _run_id(session),
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
            "run_id": _run_id(session),
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
                "run_id": _run_id(session),
                "agent_name": "imagem",
                "agent_type": "skill",
                "event_type": "start",
                "tool_name": tool_name,
                "summary": "gerando criativo visual",
            }
        return None

    # Landing-page build + deploy run through Bash (next build / wrangler). Surface the
    # meaningful steps so the dashboard shows "buildando"/"publicando" instead of nothing.
    if tool_name == "Bash":
        command = str(tool_input.get("command") or "")
        if "wrangler pages deploy" in command or "pages/projects" in command:
            return {
                "run_id": _run_id(session),
                "agent_name": "Cloudflare",
                "agent_type": "tool",
                "event_type": "step",
                "tool_name": tool_name,
                "summary": "publicando a landing page no Cloudflare Pages",
            }
        if "next build" in command:
            return {
                "run_id": _run_id(session),
                "agent_name": "build",
                "agent_type": "tool",
                "event_type": "step",
                "tool_name": tool_name,
                "summary": "buildando a landing page",
            }
        return None

    for suffix, (agent_name, agent_type, summary) in _TOOL_MAP:
        if tool_name.endswith(suffix) or suffix in tool_name:
            return {
                "run_id": _run_id(session),
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
        # run-skill.sh parses claude's stream-json (AGENT_EVENTS_FROM_STREAM=1) and is
        # the source of truth for tool events there — it also sees connector-prefixed
        # MCP tools this hook's matcher misses. Emitting PreToolUse here too would
        # duplicate every Task/WebFetch/Skill row. SubagentStop still goes through:
        # the stream has no subagent-end signal. (Suppression lives here, NOT in
        # _classify, because emit-from-stream.py reuses _classify under that env var.)
        if (
            os.environ.get("AGENT_EVENTS_FROM_STREAM")
            and str(event.get("hook_event_name") or "") == "PreToolUse"
        ):
            return 0
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
