# openwolf-hermes

Hermes Agent plugin that cooperates with [OpenWolf](https://github.com/ChasLui/openwolf)
project state (`.wolf/anatomy.md`, `.wolf/cerebrum.md`, `.wolf/memory.md`,
`.wolf/token-ledger.json`).

## What it does

Hermes' plugin protocol exposes `pre_tool_call` (mutates tool args) and
`register_command` (slash commands). It does **not** expose system-prompt
injection. So this plugin cannot make Hermes "read `.wolf/anatomy.md` before
file reads" the way Claude Code hooks can. Instead it provides:

1. **Passive bookkeeping** — when Hermes calls a file-read or file-edit tool
   in a project that has a `.wolf/` directory, the plugin appends an entry to
   `.wolf/memory.md` and updates session counters in
   `.wolf/token-ledger.json`. No prompt injection, no LLM-visible warning.
2. **`/openwolf` slash command** — `/openwolf status` shows the current
   project's `.wolf/` state; `/openwolf scan` runs `openwolf scan` as a
   subprocess.

For full hook-driven OpenWolf experience, use Claude Code. Hermes gets the
state-maintenance half but not the auto-injection half (Hermes API limit).

## Install (dev)

```bash
HERMES_PY="$(dirname $(realpath $(which hermes)))/python"
uv pip install --python "$HERMES_PY" -e <openwolf-fork>/src/agents/hermes/python
```

Then add `openwolf` to `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - openwolf
```

Restart Hermes.

The OpenWolf adapter automates all of the above:

```bash
openwolf init --agent hermes
```

## Status

Alpha. Lives in the OpenWolf fork at `src/agents/hermes/python/`. PyPI
publish deferred until plugin API stabilizes (see ADR-001 Phase 4).
