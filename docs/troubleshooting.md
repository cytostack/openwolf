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

## Dashboard shows wrong project

**Symptom:** The dashboard at `localhost:18791` shows files from a different project.

**Cause:** A stale daemon from a previous project is still running on port 18791.

**Fix:** Stop the old daemon and start a new one from the correct project:

```bash
openwolf daemon stop
```

```bash
cd your-project
openwolf dashboard
```

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

**Fix:** Either stop the existing daemon or change the port in `.wolf/config.json`:

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

**Symptom:** OpenWolf doesn't track tokens or update memory when using Claude Code or Codex App.

**Cause:** Claude Code hooks are not registered, Codex App global hooks are not registered, or the hook scripts are missing.

**Fix:** Re-run init to register hooks:

```bash
openwolf init
```

Then verify:

```bash
openwolf status
```

Look for both `✓ Claude Code hooks registered (...)` and `✓ Codex App hooks registered (6 hooks)`.

For Codex App specifically, `openwolf init` installs `~/.codex/hooks/openwolf_codex_hook.mjs` and merges entries into `~/.codex/hooks.json`. Existing Codex hooks are preserved. If Codex App was already open, start a new Codex App session after running `openwolf init` so the app reloads the hook configuration.

## Anatomy scan finds 0 files

**Cause:** The project root was detected incorrectly, or all directories are excluded.

**Fix:** Check which patterns are excluded in `.wolf/config.json` under `anatomy.exclude_patterns`. Run the scan with verbose output:

```bash
openwolf scan
```

If files are missing, adjust the exclude patterns. The defaults skip `node_modules`, `.git`, `dist`, `build`, and similar directories.

## designqc: Chrome/Edge not found

**Symptom:** Running `openwolf designqc` shows "Chrome/Edge not found".

**Cause:** Design QC uses `puppeteer-core` which requires an existing browser installation. It does not bundle its own browser.

**Fix:** Install Chrome or Edge, or set the browser path manually in `.wolf/config.json`:

```json
{
  "designqc": {
    "chrome_path": "/path/to/chrome"
  }
}
```

Auto-detection checks these locations in order:
1. `designqc.chrome_path` in `.wolf/config.json` (if set)
2. Google Chrome (standard install paths)
3. Microsoft Edge (standard install paths)
4. Chromium

## designqc: puppeteer-core not installed

**Symptom:** Running `openwolf designqc` shows "puppeteer-core is required for designqc".

**Cause:** `puppeteer-core` is an optional dependency and was not installed with OpenWolf.

**Fix:** Install it manually:

```bash
npm install puppeteer-core
```

This installs the Puppeteer library without downloading a bundled browser (that is what makes it `puppeteer-core` rather than full `puppeteer`).

## designqc: Dev server not detected

**Symptom:** Running `openwolf designqc` shows "No running server found" or "No dev script found".

**Cause:** Design QC needs a running dev server to capture screenshots. It tries to detect one automatically but could not find it.

**Fix:** Either start your dev server manually and pass the URL:

```bash
openwolf designqc --url http://localhost:3000
```

Or add a `dev`, `start`, or `serve` script to your `package.json` so that Design QC can detect and start it automatically:

```json
{
  "scripts": {
    "dev": "vite"
  }
}
```

## designqc: Screenshots only show top of page

**Symptom:** Captured screenshots only contain the top portion of the page.

**Cause:** This should not happen in v1.0.0. The capture system uses sectioned capture, which scrolls through the full page taking viewport-height sections until the entire page is covered.

**Fix:** Rebuild OpenWolf to ensure you have the latest capture logic:

```bash
cd openwolf
pnpm build
```

If the issue persists, check that the page content is fully loaded before capture. Pages that lazy-load content on scroll may require a longer wait time.

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
