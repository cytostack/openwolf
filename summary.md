# OpenWolf Security Audit & Patches - May 2026

This document summarizes the security vulnerabilities identified and patched in the OpenWolf codebase.

## Vulnerabilities Fixed

### 1. Command Injection in CLI (Critical)
*   **Vulnerability:** Unsanitized project paths and daemon names were passed directly to `execSync` string templates.
*   **Impact:** Arbitrary code execution if a project was placed in a directory with shell metacharacters (e.g., ``my-project`; rm -rf /`).
*   **Fix:** Replaced `execSync` with `execFileSync` using array-based arguments in `src/cli/daemon-cmd.ts` and `src/cli/init.ts`. This prevents shell interpolation of arguments.
*   **Verification:** Verified via `tests/security.test.ts` ensuring metacharacters are handled as literal strings.

### 2. Lack of Authentication & Information Disclosure (High)
*   **Vulnerability:** The dashboard server (Express + WebSocket) had no authentication and was exposed on all network interfaces.
*   **Impact:** Unauthorized access to project metadata, file contents in `.wolf/`, and the ability to trigger cron tasks by anyone on the network.
*   **Fix:**
    *   Explicitly bound the Express server to `127.0.0.1` in `src/daemon/wolf-daemon.ts`.
    *   Implemented session-based token authentication. A secure token is generated on startup and saved to `.wolf/daemon-token.tmp`.
    *   Added middleware to require the token for all API and WebSocket connections.
    *   Updated the CLI to automatically pass the token when opening the dashboard.
*   **Verification:** Verified explicit binding and unauthorized access rejection in test suite.

### 3. Path Traversal in Cron Engine (Medium)
*   **Vulnerability:** The `ai_task` action in `CronEngine` blindly joined file paths, allowing reads outside the project root.
*   **Impact:** Potential disclosure of sensitive system files (e.g., `/etc/passwd`) if `cron-manifest.json` was manipulated.
*   **Fix:** Added path resolution and prefix validation in `src/daemon/cron-engine.ts` to ensure all context files stay within the project root.
*   **Verification:** Verified that `../` paths are blocked in `tests/security.test.ts`.

### 4. Denial of Service in File Watcher (Low)
*   **Vulnerability:** The file watcher broadcasted full contents of changed files regardless of size.
*   **Impact:** Memory exhaustion or network congestion when handling large files.
*   **Fix:** Enforced a 1MB limit in `src/daemon/file-watcher.ts`. Files larger than this are logged but not broadcasted.
*   **Verification:** Verified size limit logic in test suite.

## Verification
A new automated test harness was added:
*   **Test Runner:** Node.js native (`node:test`)
*   **Command:** `npm test`
*   **Results:** 4/4 security tests passing.

---
*Created by Gemini CLI*
