# Troubleshooting

Common issues and their solutions.

## Daemon won't stop

**Symptom:** `openwolf daemon stop` shows "Process or Namespace not found".

**Cause:** The daemon was started via `openwolf dashboard` (which uses `fork()`), not via PM2.

**Fix:** As of the latest version, `openwolf daemon stop` handles both PM2 and non-PM2 daemons automatically. It falls back to finding and killing the process listening on the dashboard port. If you're on an older version, you can manually kill it:

::: code-group
```bash [Windows]
netstat -ano -p tcp | findstr :18791
taskkill /PID <pid> /F
```

```bash [macOS/Linux]
lsof -ti :18791 | xargs kill
```
:::

## AI tasks fail with "Credit balance is too low"

**Symptom:** Cerebrum reflection or AI suggestions show "Failed" in the Cron Control Center. Daemon log shows `Exit code 1: Credit balance is too low`.

**Cause:** The `ANTHROPIC_API_KEY` environment variable is set and points to an API key with depleted credits. When Claude CLI sees this variable, it uses the API key instead of your subscription.

**Fix:** OpenWolf automatically strips `ANTHROPIC_API_KEY` from the environment when running AI tasks. If you're still seeing this error, ensure you're running the latest build:

```bash
cd openwolf
pnpm build
```

Then restart the daemon:

```bash
openwolf daemon stop
openwolf dashboard
```

## AI tasks fail with "ENOENT" or "claude not found"

**Symptom:** Daemon log shows `spawnSync claude ENOENT`.

**Cause:** On Windows, Node.js `spawnSync` can't find `.cmd` wrappers (like `claude.cmd`) without `shell: true`.

**Fix:** This is fixed in the latest version. Rebuild and restart the daemon.

## Dashboard shows the wrong project (multi-project)

**Symptom:** Opening one project's dashboard shows another project's data, or a 401 token error.

**Cause:** Projects created under 1.x all shared the default ports, so their daemons collided and only the first one to start would serve.

**Fix:** This is resolved in OpenWolf 2. Run `openwolf update` once and every project is reassigned a unique port pair. From then on `openwolf dashboard` opens each project on its own port, and if a port is ever still occupied the launcher automatically starts on a free one. A rejected token now shows a clear message instead of a blank screen.

## Dashboard shows "AI development assistant" instead of project info

**Symptom:** The Overview panel shows "AI development assistant for this project" as the description.

**Cause:** The project's `package.json` doesn't have a `description` field, and there's no README or `cerebrum.md` with project info.

**Fix:** Add a `description` to your `package.json`:

```json
{
  "name": "my-project",
  "description": "A short description of what this project does"
}
```

Or let OpenWolf detect it from your README. The daemon checks (in order):
1. `package.json` → `description` field
2. `.wolf/cerebrum.md` → `**Project:**` entry
3. `README.md` → first meaningful paragraph

## Blank command window flashes on Windows

**Symptom:** When AI tasks run, a blank cmd.exe window briefly appears and closes.

**Cause:** Node.js `spawnSync` with `shell: true` opens a cmd window by default on Windows.

**Fix:** OpenWolf uses `windowsHide: true` to suppress this. Rebuild if you're seeing it.

## Port 18791 already in use

**Symptom:** Dashboard fails to start because the port is occupied.

**Fix:** In OpenWolf 2, `openwolf dashboard` automatically starts on a free port when the configured one is taken, so this rarely happens. To set a fixed port anyway, change it in `.wolf/config.json`:

```json
{
  "openwolf": {
    "dashboard": {
      "port": 18792
    }
  }
}
```

## Hooks not firing

**Symptom:** OpenWolf doesn't track tokens or update memory when using your agent.

**Cause:** The agent's hooks aren't registered or the hook scripts are missing.

**Fix:** Re-run init to register hooks:

```bash
openwolf init
```

Then verify:

```bash
openwolf status
```

Look for the line confirming the agent's hooks are registered.

## Anatomy scan finds 0 files

**Cause:** The project root was detected incorrectly, or all directories are excluded.

**Fix:** Check which patterns are excluded in `.wolf/config.json` under `anatomy.exclude_patterns`. Run the scan with verbose output:

```bash
openwolf scan
```

If files are missing, adjust the exclude patterns. The defaults skip `node_modules`, `.git`, `dist`, `build`, and similar directories.

## scan --check exits with code 1

**Symptom:** Running `openwolf scan --check` exits with code 1.

**Cause:** This is expected behavior. Exit code 1 means `anatomy.md` is out of date compared to the actual project files.

**Fix:** Run a full scan to update `anatomy.md`:

```bash
openwolf scan
```

Then re-run `openwolf scan --check` to confirm it now exits with code 0. This is useful in CI pipelines to enforce that anatomy is kept current.

## Commands say "OpenWolf not initialized"

**Symptom:** Running commands like `openwolf cron`, `openwolf bug`, or `openwolf daemon` shows "OpenWolf not initialized".

**Cause:** The project has not been initialized with OpenWolf. These commands require the `.wolf/` directory and its configuration files to exist.

**Fix:** Initialize OpenWolf in your project root:

```bash
openwolf init
```

This creates the `.wolf/` directory with `anatomy.md`, `cerebrum.md`, `memory.md`, `buglog.json`, and other required files.
