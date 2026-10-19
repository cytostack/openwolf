# Getting started

OpenWolf adds local project memory and context tools to your coding agent. It stores notes, a project map and session data in `.wolf/`.

These instructions cover OpenWolf 2.5.3. See the [release notes](release-2.5.3.md) for changes and the [upgrade guide](updating.md) for existing installations.

## Install the published package

Use Node.js 20 or later on Linux, macOS or Windows.

```bash
npm install -g openwolf
cd your-project
openwolf init
```

`init` detects installed agents, creates project files and scans eligible source files. To select agents yourself:

```bash
openwolf init --agent claude codex opencode antigravity
```

Grok Build can use `--agent grok` with enabled Claude-compatible hooks. Antigravity can use `--agent antigravity` with a bridged hook adapter (`.agents/hooks.json`). Cursor and Gemini CLI receive project instructions only. See [agent hook coverage](hooks.md).

## Check the installation

```bash
openwolf --version
openwolf status
openwolf operations doctor
```

Start a new agent session. Complete any project or hook trust review required by that agent. For Codex, project hooks must be enabled in the installed Codex version. OpenWolf preserves existing settings and reports configuration problems it cannot safely repair.

## Use the project map

```bash
openwolf find validateToken
openwolf find --file src/auth.ts
openwolf map --focus auth
```

These commands help locate relevant files and symbols before reading source text. Missing or stale entries may need a new scan:

```bash
openwolf scan
```

## Review usage and activity

```bash
openwolf dashboard
openwolf usage report --json
```

The dashboard starts a local daemon if needed. It shows memory, project state, available usage records and hook health. Token records may be incomplete if the agent did not save the required data. Model cost estimates are separate from your subscription bill.

## Save work for another session

A checkpoint can hold the objective, completed work, unresolved problems and next action. Handover packets can transfer selected saved Claude or Codex evidence into an explicit receiving session. Follow the [handover workflow](claude-codex-handoff-plan.md) for export, inspection and import.

Saved evidence does not grant permission to run commands. Automatic durable instruction injection requires independent administrator approval and a protected installation. Regular project maps, checkpoints and activity reporting do not require that setup.

## Share project notes

The generated `.wolf/.gitignore` excludes machine-local runtime data. Review both the ignore rules and file contents before committing project notes, bug records or the project map. Automated sensitive-file detection does not replace that review.

For existing projects, follow [update and restore](updating.md).
