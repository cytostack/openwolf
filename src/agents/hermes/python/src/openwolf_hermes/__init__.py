"""
OpenWolf plugin for Hermes Agent.

Cooperates with `.wolf/` project state when Hermes runs in an OpenWolf-managed
project (i.e. cwd contains a .wolf/ directory). See README for full rationale.

Discovery: entry-point group `hermes_agent.plugins`, name `openwolf`.
Enable in ~/.hermes/config.yaml under `plugins.enabled`.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

__version__ = "0.1.0"

logger = logging.getLogger(__name__)

# Tool name aliases — Hermes may expose file-op tools under various names.
# We match case-insensitively against any of these.
_FILE_READ_TOOLS = frozenset(
    {"read", "readfile", "read_file", "view", "cat", "openfile", "open_file"}
)
_FILE_WRITE_TOOLS = frozenset(
    {"write", "writefile", "write_file", "edit", "edit_file", "create", "createfile"}
)


def _wolf_dir(cwd: Optional[str] = None) -> Optional[Path]:
    """Return Path to .wolf/ if cwd (or its parents) has one, else None."""
    start = Path(cwd or os.getcwd()).resolve()
    for d in [start, *start.parents]:
        candidate = d / ".wolf"
        if candidate.is_dir():
            return candidate
    return None


def _append_memory(wolf: Path, line: str) -> None:
    memory = wolf / "memory.md"
    try:
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        with memory.open("a", encoding="utf-8") as fh:
            fh.write(f"- {ts} {line}\n")
    except OSError as exc:
        logger.debug("[openwolf] could not append to memory.md: %s", exc)


def _bump_counter(wolf: Path, key: str) -> None:
    """Increment a counter in token-ledger.json (best-effort, fail-silent)."""
    ledger_path = wolf / "token-ledger.json"
    try:
        if ledger_path.exists():
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
        else:
            ledger = {"version": 1, "lifetime": {}}
        lifetime = ledger.setdefault("lifetime", {})
        lifetime[key] = int(lifetime.get(key, 0)) + 1
        ledger_path.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError) as exc:
        logger.debug("[openwolf] could not bump %s in token-ledger: %s", key, exc)


def _normalize_tool(tool_name: str) -> str:
    return tool_name.lower().replace("-", "").replace("_", "")


def _extract_path(args: dict) -> Optional[str]:
    for key in ("file_path", "path", "filename", "file"):
        v = args.get(key) if isinstance(args, dict) else None
        if isinstance(v, str) and v.strip():
            return v
    return None


def _pre_tool_call(*, tool_name: str, args: dict, task_id: str = "", **_kwargs) -> None:
    """Pre-tool hook: bookkeeping for .wolf/ projects.

    Does NOT mutate args. Hermes calls the tool with whatever the LLM produced.
    """
    if not isinstance(args, dict):
        return

    wolf = _wolf_dir()
    if wolf is None:
        return  # Not an OpenWolf project — nothing to do.

    norm = _normalize_tool(tool_name or "")
    file_path = _extract_path(args)

    if norm in _FILE_READ_TOOLS:
        if file_path:
            _append_memory(wolf, f"read: {file_path}")
            _bump_counter(wolf, "total_reads")
    elif norm in _FILE_WRITE_TOOLS:
        if file_path:
            _append_memory(wolf, f"write: {file_path}")
            _bump_counter(wolf, "total_writes")


def _handle_command(raw_args: str = "") -> str:
    """Slash command `/openwolf [status|scan]`."""
    args = (raw_args or "").strip().split()
    sub = args[0] if args else "status"

    wolf = _wolf_dir()
    if wolf is None:
        return f"openwolf: no .wolf/ in {os.getcwd()} (or parents). Run `openwolf init` first."

    if sub == "status":
        anatomy = wolf / "anatomy.md"
        cerebrum = wolf / "cerebrum.md"
        ledger_path = wolf / "token-ledger.json"
        try:
            ledger = (
                json.loads(ledger_path.read_text(encoding="utf-8"))
                if ledger_path.exists()
                else {}
            )
        except (OSError, ValueError):
            ledger = {}
        return json.dumps(
            {
                "wolf_dir": str(wolf),
                "version": __version__,
                "anatomy_exists": anatomy.exists(),
                "cerebrum_exists": cerebrum.exists(),
                "lifetime": ledger.get("lifetime", {}),
            },
            indent=2,
        )

    if sub == "scan":
        try:
            result = subprocess.run(
                ["openwolf", "scan"],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=wolf.parent,
            )
            return (result.stdout or "") + (result.stderr or "")
        except FileNotFoundError:
            return "openwolf binary not found in PATH"
        except subprocess.TimeoutExpired:
            return "openwolf scan timed out"

    return "Usage: /openwolf [status|scan]"


def register(ctx) -> None:
    """Hermes plugin entry point."""
    register_command = getattr(ctx, "register_command", None)
    if callable(register_command):
        try:
            register_command(
                "openwolf",
                handler=_handle_command,
                description="OpenWolf project state (.wolf/) status / scan",
            )
        except Exception as exc:
            logger.debug("[openwolf] slash command registration skipped: %s", exc)

    register_hook = getattr(ctx, "register_hook", None)
    if callable(register_hook):
        register_hook("pre_tool_call", _pre_tool_call)
        logger.info("[openwolf] Hermes plugin registered (v%s)", __version__)
    else:
        logger.warning("[openwolf] ctx.register_hook missing — plugin inactive")
