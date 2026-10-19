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
| Antigravity | `.agents/hooks.json` bridge and `AGENTS.md` | A bridge script (`antigravity-bridge.js`) translates Antigravity's camelCase tool events (`view_file`, `write_to_file`, `replace_file_content`, `run_command`) and `PreInvocation`/`Stop` events to OpenWolf's read/write/bash and session-start/stop hooks. Does not cover `user-prompt-submit`, `post-batch` or `precompact`; those have no Antigravity equivalent. See the two limits below. |
| Cursor, Gemini CLI | Project instruction files | No full hook integration or equivalent usage coverage is claimed. |

See [2.5.3 release validation](release-2.5.3.md) for OpenCode V2 checks and [2.5.2 validation](release-2.5.2.md) for earlier native integration results.

### Antigravity limits

- **Saved context only injects on the first model call.** The bridge maps `PreInvocation` to `session-start.js` only when `invocationNum === 1`. Antigravity does not re-emit `PreInvocation` with saved-context injection support on later model calls within the same session, so a handoff or checkpoint that becomes available after the first call is not automatically surfaced; use `openwolf handoff recover --from antigravity --session <id>` (or re-check `openwolf handoff list`) to pull it in manually.
- **`Stop` is a per-turn boundary, not a true session end.** Antigravity has no dedicated session-end event, so the bridge's `Stop` mapping runs `stop.js` (an idempotent per-turn ledger flush) on every turn, never `session-end.js`. The one-time "Session end" line in `memory.md` and the session's `ended` timestamp are therefore never written automatically. Run `openwolf finalize --agent antigravity --session <id>` after the final turn to write them.

Antigravity sessions participate in `openwolf handoff` (`checkpoint`, `list`, `read`, `recover`, `export`, `import`) through the same hook-captured checkpoint state the bridge already accumulates. Because Antigravity's own conversation transcript is not decoded, a packet exported *from* an antigravity session has no independently re-readable source file, so `handoff import` correctly refuses it as unverifiable; importing *into* an antigravity session (e.g. from a Claude or Codex handoff) is fully supported and is surfaced automatically on the next `session-start.js`.

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

### October reliability changes

Claude and Codex SessionStart hooks have a 15-second timeout; ordinary tool hook budgets are unchanged. Hook dependency checks reuse a cache only while installed JavaScript file metadata is unchanged. Old session-file collection runs in a separate background process after startup context is produced. This reduces synchronous maintenance; it is not a guarantee that every machine completes within the timeout.

OpenCode V2 migration preserves customized files. If any old plugin file is unrecognized or edited, installation stops with a warning instead of recursively deleting the directory or installing a second API generation alongside it. Review those files before retrying. V2 usage is recorded per assistant step, including reported failed-step usage; cumulative session totals are not added as separate usage. Missing model attribution remains unknown.
