#!/usr/bin/env python3
"""Parse `claude -p --output-format stream-json --verbose` NDJSON on stdin, emit
one `agent_events` row per tool call, and pass a human-readable line per event to
stdout so the run log stays useful.

Why this exists (not a hook): Claude Code does NOT execute settings-file hooks in
non-interactive `-p` mode — it is an intentional limitation, see
https://github.com/anthropics/claude-code/issues/40506 (closed "not planned").
Verified on the runner: every settings source is watched but
`Hooks: Found 0 total hooks in registry`. So instead of relying on hooks, we tap
claude's own output stream — the official workaround for headless telemetry.

The tool-name classification is reused verbatim from the PreToolUse hook
(.claude/hooks/emit-agent-event.py) so there is a single source of truth for the
mapping and the Supabase insert. The hook still works locally (git repo +
interactive trust); this covers the headless runner.

Fail-safe: any error on a line is swallowed — telemetry must never break a run.
Needs SUPABASE_URL + SUPABASE_SECRET_KEY in the environment (present on the Fly
runner), same as the hook.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys

# Reuse the hook's classifier/emitter (single source of truth for the mapping).
_HOOK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".claude", "hooks", "emit-agent-event.py")


def _load_hook_module():
    spec = importlib.util.spec_from_file_location("emit_agent_event", _HOOK_PATH)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MOD = None
try:
    _MOD = _load_hook_module()
except Exception:  # noqa: BLE001 — telemetry must never break the run.
    _MOD = None


# When a job runs through the agent_jobs queue, the poller exports AGENT_JOB_ID. Stamping
# it as the event's run_id links every agent_events row of this run to its job — which is how
# the autonomous-mode watch (ADR 0019) correlates a watched job to its granular activity
# ("lançou o subagente Z"). Without a queued job (direct cron run) we keep the Claude
# session_id as run_id, exactly as before — fully backward compatible.
_JOB_RUN_ID = (os.environ.get("AGENT_JOB_ID") or "").strip() or None


def _emit_tool(session: str, name: str, tool_input: object) -> None:
    """Build a synthetic PreToolUse event and route it through the hook's classifier."""
    if _MOD is None:
        return
    event = {
        "hook_event_name": "PreToolUse",
        "session_id": session,
        "tool_name": name,
        "tool_input": tool_input if isinstance(tool_input, dict) else {},
    }
    try:
        row = _MOD._classify(event)
        if row is not None:
            if _JOB_RUN_ID is not None:
                row["run_id"] = _JOB_RUN_ID
            _MOD._emit(row)
    except Exception:  # noqa: BLE001
        pass


def main() -> int:
    session = ""
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        if not line.strip():
            continue

        try:
            obj = json.loads(line)
        except ValueError:
            # Not a JSON event (stderr passthrough, partial line) — keep the log readable.
            print(line, flush=True)
            continue

        etype = obj.get("type")

        if etype == "system" and obj.get("subtype") == "init":
            session = str(obj.get("session_id") or "")[:64]
            print(f"[init] session={session} model={obj.get('model', '')}", flush=True)

        elif etype == "assistant":
            message = obj.get("message") or {}
            session = str(obj.get("session_id") or message.get("id") or session)[:64]
            for block in message.get("content") or []:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "tool_use":
                    name = str(block.get("name") or "")
                    _emit_tool(session, name, block.get("input"))
                    print(f"[tool] {name}", flush=True)
                elif btype == "text":
                    text = str(block.get("text") or "").strip()
                    if text:
                        print(text, flush=True)

        elif etype == "result":
            result = obj.get("result")
            if not isinstance(result, str):
                result = str(obj.get("subtype") or "")
            print(f"[result] {result}", flush=True)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        sys.exit(0)
