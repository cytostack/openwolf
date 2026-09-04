import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const TOKEN_FILE = "dashboard-token";
const TOKEN_MODE = 0o600;

// Warn at most once per token path per process. validateDashboardToken()
// runs getDashboardToken() on every authenticated request, so an unconditional
// warning would flood the daemon log on a readable token file.
const warned = new Set<string>();

function warnOnce(tokenPath: string, detail: string): void {
  if (warned.has(tokenPath)) return;
  warned.add(tokenPath);
  console.error(
    `openwolf: could not restrict permissions on ${tokenPath} (${detail}). ` +
      `This file is a bearer credential; other local users may be able to read it. ` +
      `Fix with: chmod 600 ${tokenPath}`,
  );
}

/**
 * Tightens an existing token file to 0600 in place.
 *
 * Issue #79, reported with PR #107 by @davdittrich.
 *
 * Never rotates or rewrites the token: a world-readable token is still the
 * token the running dashboard and any open browser tab are using, and
 * regenerating it here would break live sessions to fix a permission bug.
 * Returns false when the mode could not be tightened so the caller can warn.
 */
function ensureTokenMode(tokenPath: string): boolean {
  // POSIX mode bits are not meaningful on win32.
  if (process.platform === "win32") return true;
  try {
    if ((fs.statSync(tokenPath).mode & 0o777) === TOKEN_MODE) return true;
    fs.chmodSync(tokenPath, TOKEN_MODE);
  } catch (err) {
    warnOnce(tokenPath, err instanceof Error ? err.message : String(err));
    return false;
  }
  try {
    if ((fs.statSync(tokenPath).mode & 0o777) === TOKEN_MODE) return true;
  } catch {}
  // Some filesystems (mounted volumes, WSL 9P, FAT) accept chmod and keep the
  // old mode. The token is unchanged and still usable, so say so and move on.
  warnOnce(tokenPath, "filesystem did not apply the new mode");
  return false;
}

export function getDashboardToken(wolfDir: string): string {
  const tokenPath = path.join(wolfDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(tokenPath, "utf-8").trim();
    if (/^[a-f0-9]{64}$/.test(existing)) {
      ensureTokenMode(tokenPath);
      return existing;
    }
  } catch {}

  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token + "\n", { encoding: "utf-8", mode: TOKEN_MODE });
  // writeFileSync only applies `mode` when it creates the file. Reaching here
  // with an existing file (unreadable or malformed token) keeps whatever mode
  // that file already had, so apply the mode explicitly.
  ensureTokenMode(tokenPath);
  return token;
}

export function validateDashboardToken(wolfDir: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = getDashboardToken(wolfDir);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
