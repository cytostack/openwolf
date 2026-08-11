import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const TOKEN_FILE = "dashboard-token";

export function getDashboardToken(wolfDir: string): string {
  const tokenPath = path.join(wolfDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(tokenPath, "utf-8").trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return existing;
  } catch {}

  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token + "\n", { encoding: "utf-8", mode: 0o600 });
  return token;
}

export function validateDashboardToken(wolfDir: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = getDashboardToken(wolfDir);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
