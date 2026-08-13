# Design QC

Screenshot capture tool that lets Claude Code evaluate your app's design visually. Capture-only architecture -- no separate API key needed.

## Overview

Design QC captures screenshots of your running application and saves them where Claude can read them. You then ask Claude to evaluate the images, provide feedback, or verify fixes. The entire workflow stays inside your existing Claude subscription -- no vision API key required.

## Requirements

- **puppeteer-core** -- install it in your project or globally:
  ```bash
  npm install puppeteer-core
  ```
- **Chrome or Edge** -- a Chromium-based browser must be installed. OpenWolf auto-detects the browser path (see [Chrome Detection](#chrome-detection) below).

---

## How It Works

### 1. Dev Server Detection

Design QC first checks whether a dev server is already running. It probes these ports in order:

```
3000, 3001, 5173, 5174, 4321, 8080, 8000, 4200
```

If a server responds on any of these ports, Design QC uses it directly.

### 2. Automatic Server Startup

If no running server is found, Design QC reads your `package.json` scripts and looks for `dev`, `start`, or `serve` (in that order). It detects your package manager (`pnpm`, `yarn`, `npm`, or `bun`) and starts the server automatically. The server is stopped when capture completes.

### 3. Route Detection

Design QC scans your project for route files:

- **Next.js** -- `pages/` and `app/` directories
- **Vite / React Router** -- `pages/` directory
- **Astro** -- `src/pages/` directory

Detected routes are queued for capture unless you specify `--routes` manually.

### 4. Screenshot Capture

For each route, Design QC:

1. Opens the page in a headless Chromium instance
2. Scrolls through the full page height
3. Takes a viewport-height JPEG at each scroll position (one per "fold")
4. Captures up to `designqc.max_screenshots` sections per route (default 6)
5. Repeats for both desktop (1440px) and mobile (375px) viewports by default

Screenshots are saved as JPEG at quality 70, max width 1200px -- optimized for token economy at roughly **2,500 tokens per screenshot**.

### 5. Output

All captures are saved to:

```
.wolf/designqc-captures/
```

If Design QC started a dev server automatically, it stops the server after all captures are complete.

---

## Usage

```bash
openwolf designqc                                # auto-detect everything
openwolf designqc --url http://localhost:3000     # specify URL
openwolf designqc --routes / /about /pricing      # specific routes
openwolf designqc --desktop-only                  # skip mobile viewport
openwolf designqc --quality 50                    # lower quality = fewer tokens
```

| Flag | Description |
|------|-------------|
| `--url <url>` | Skip server detection, use this URL directly |
| `--routes <paths...>` | Capture only these routes instead of auto-detecting |
| `--desktop-only` | Skip the mobile (390px) viewport |
| `--quality <number>` | JPEG quality (1-100). Default: 70. Lower = smaller = fewer tokens |

---

## Workflow with Claude

The intended workflow is a feedback loop between Design QC captures and Claude's visual analysis:

```
You: openwolf designqc
You (to Claude): Read the screenshots in .wolf/designqc-captures/ and evaluate the design
Claude: [reads images, provides detailed design feedback]
You: Fix the spacing issues on the pricing page
Claude: [makes the CSS/component fixes]
You: openwolf designqc
You (to Claude): Read the new screenshots and verify the fixes
Claude: [compares before/after, confirms fixes or flags remaining issues]
```

This loop works because Claude Code can read image files directly. No additional API calls beyond your normal Claude usage.

---

## Configuration

Design QC settings can be configured in `.wolf/config.json` under the `designqc` section. See the [Configuration](/configuration) page for the full schema.

---

## Chrome Detection

OpenWolf searches for a Chromium-based browser in this order. The OS default browser is checked first — if it's Chromium-based (Chrome, Edge, Brave, etc.), it's used directly; non-Chromium defaults (e.g. Firefox) are skipped.

**Windows:**
1. `designqc.chromePath` in `.wolf/config.json` (manual override)
2. System default browser (registry `UserChoice` ProgId) — only if Chromium-based
3. `Program Files/Google/Chrome/Application/chrome.exe`
4. `Program Files (x86)/Google/Chrome/Application/chrome.exe`
5. `Program Files/Microsoft/Edge/Application/msedge.exe`
6. `Program Files (x86)/Microsoft/Edge/Application/msedge.exe`
7. `where chrome` / `where msedge` (PATH lookup)

**macOS:**
1. Config override
2. System default browser (LaunchServices) — only if Chromium-based
3. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
4. `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`

**Linux:**
1. Config override
2. System default browser (`xdg-settings`) — only if Chromium-based
3. `which google-chrome`
4. `which google-chrome-stable`
5. `which chromium-browser`
6. `which chromium`
7. `which microsoft-edge`

If no browser is found, Design QC exits with an error and instructions to set the path manually in config.

---

## Token Cost

Each screenshot consumes approximately **2,500 tokens** when Claude reads it.

The math for a single route with default settings:

| Factor | Value |
|--------|-------|
| Sections per route | Up to 6 (default `max_screenshots`) |
| Viewports | 2 (desktop + mobile) |
| Tokens per screenshot | ~2,500 |
| **Max per route** | **~30,000 tokens** |

For a site with 5 detected routes, that is up to 200K tokens per full capture. To reduce cost:

- Use `--desktop-only` to cut token usage in half
- Use `--routes / /about` to capture only the pages you care about
- Use `--quality 50` (or lower) to reduce image size and token consumption
- Fix one page at a time rather than capturing the entire site repeatedly
