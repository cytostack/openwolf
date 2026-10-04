# Agent hooks and support

A hook is a script that an agent runs at a defined event, such as session start or completion of a tool call. OpenWolf uses these events to record work, provide context and report its own activity.

Agent support is different across products and versions. A registered hook is not proof that every tool path or event was delivered.

## Integration by agent

| Agent | Connection | Main limits |
| --- | --- | --- |
| Claude Code | Project settings and lifecycle hooks | Output replacement and event delivery depend on Claude's supported hook channels. |
| Codex CLI | `.codex/hooks.json` and `AGENTS.md` | Requires hook support, enabled settings and project trust. Tool names and payloads can differ by version. |
| OpenCode | Native plugin and `AGENTS.md` | Uses session and tool events. It does not implement every Claude hook feature. |
| Grok Build | Enabled Claude-compatible discovery | Uses the existing registration. OpenWolf activity notices are dashboard-only. |
| Cursor, Gemini CLI, Antigravity | Project instruction files | No full hook integration or equivalent usage coverage is claimed. |

See [release validation](release-2.5.2.md) for the native versions that were checked.

## What hooks do

| Event or script | Work performed when supported |
| --- | --- |
| `session-start.js` | Check the installed runtime, load a short project index and return available saved context. |
| `user-prompt-submit.js` | Return changed task evidence and queued reminders with the next prompt. |
| `pre-read.js` | Offer file or symbol guidance and identify eligible duplicate reads. |
| `pre-write.js` | Retrieve relevant prior fixes and approved project rules. |
| `pre-bash.js` | Suggest limits for commands likely to produce large output. |
| `post-read.js` | Record completed reads and distinguish ranged reads. |
| `post-write.js` | Record edits, refresh affected project entries and check memory size budgets. |
| `post-bash.js` | Apply supported output controls and track simple file reads made through Bash. |
| `post-batch.js` | Return selected approved rules at the configured interval. |
| `precompact.js` | Save session state before compaction. |
| `stop.js` | Reconcile session observations and usage; queue eligible reminders. |
| `session-end.js` | Perform a final flush and record session completion. |

The OpenCode plugin performs its work through native session and tool events. Grok uses compatible events where available. Do not assume that the table describes every agent equally.

`openwolf init` checks `opencode --version` before installing the integration. OpenCode 1 receives the legacy plugin under `.opencode/plugin/`; OpenCode 2 receives a default `id`/`setup` plugin under `.opencode/plugins/`. If the executable cannot be queried, OpenWolf keeps the V1-compatible fallback and reports a warning; rerun `openwolf init` after installing or upgrading OpenCode.

## Permissions and memory authority

OpenWolf does not auto-approve agent tool calls. Project and hook trust prompts belong to the agent and remain in place.

Saved conversations, notes and packets are task evidence. Automatic durable instruction injection requires a protected runtime and independent administrator approval. User-owned npm files cannot establish that authority.

## Hook health

Standalone hooks record their last success, last error and consecutive failures in `.wolf/hooks/_heartbeat.json`. The dashboard and status commands help identify missing or broken runtime files.

```bash
openwolf status
openwolf operations doctor
```

A missing heartbeat can mean that a hook was not installed, was not trusted or was not called by that agent. Inspect the agent's own logs before treating it as a confirmed OpenWolf failure.

## Notices and update checks

Completed operations can create local activity receipts. Claude can show a status-line segment, Codex can show recovery notices, and OpenCode can show toasts. Message limits reduce repetition. Grok and headless sessions retain dashboard history without terminal notices.

Update checks run in a detached worker. Tool hooks do not wait for npm requests or installation. The worker adds background network and disk work, while memory and indexing stay local. Read [session visibility](session-visibility-plan.md) and [automatic updates](automatic-updates.md) for configuration.
