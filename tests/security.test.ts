import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

// Security regression suite. Origin: PR #34 (riverwolf67), extended when
// reconciling with PR #30 (svanack404).

describe("command injection", () => {
  test("execFileSync passes metacharacters through as literal arguments", () => {
    if (process.platform === "win32") return;
    const scriptPath = path.join(os.tmpdir(), `openwolf-sec-${process.pid}.sh`);
    const maliciousArg = "safe; echo 'pwned'";
    fs.writeFileSync(scriptPath, '#!/bin/bash\necho "ARG: $1"', { mode: 0o755 });
    try {
      const output = execFileSync(scriptPath, [maliciousArg], { encoding: "utf-8" });
      assert.strictEqual(output.trim(), `ARG: ${maliciousArg}`);
    } finally {
      fs.unlinkSync(scriptPath);
    }
  });

  test("no string-interpolated execSync remains for dynamic values", () => {
    // Static `which x || which y` probes are allowed; anything interpolating
    // a runtime value (port, name, path) must use execFileSync array args.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!p.endsWith(".ts")) continue;
        const src = fs.readFileSync(p, "utf-8");
        for (const m of src.matchAll(/execSync\((`[^`]*\$\{[^`]*`)/g)) {
          offenders.push(`${p}: ${m[1]}`);
        }
      }
    };
    walk(path.resolve(import.meta.dirname, "..", "src"));
    assert.deepStrictEqual(offenders, []);
  });
});

describe("dashboard auth", () => {
  test("token is generated once, 64 hex chars, mode 0600", async () => {
    const { getDashboardToken, validateDashboardToken } = await import("../src/utils/dashboard-auth.ts");
    const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-sec-"));
    const t1 = getDashboardToken(wolfDir);
    const t2 = getDashboardToken(wolfDir);
    assert.match(t1, /^[a-f0-9]{64}$/);
    assert.strictEqual(t1, t2, "token must be stable across calls");
    if (process.platform !== "win32") {
      const mode = fs.statSync(path.join(wolfDir, "dashboard-token")).mode & 0o777;
      assert.strictEqual(mode, 0o600);
    }
    assert.strictEqual(validateDashboardToken(wolfDir, t1), true);
    assert.strictEqual(validateDashboardToken(wolfDir, "0".repeat(64)), false);
    assert.strictEqual(validateDashboardToken(wolfDir, null), false);
    assert.strictEqual(validateDashboardToken(wolfDir, ""), false);
  });
});

describe("path traversal", () => {
  test("resolve+relative check rejects escapes, accepts inside paths", () => {
    const projectRoot = path.resolve(os.tmpdir(), "fake-project");
    const check = (file: string): boolean => {
      const resolved = path.resolve(projectRoot, file);
      const rel = path.relative(projectRoot, resolved);
      return !(rel.startsWith("..") || path.isAbsolute(rel));
    };
    assert.strictEqual(check("../../etc/passwd"), false);
    assert.strictEqual(check("/etc/passwd"), false);
    assert.strictEqual(check("src/index.ts"), true);
    assert.strictEqual(check("./README.md"), true);
  });
});

describe("secret file redaction (issue #54)", () => {
  test("isSensitiveFile covers keys, stores, credentials — not normal files", async () => {
    const { isSensitiveFile } = await import("../src/hooks/shared.ts");
    for (const f of [
      ".env", ".env.local", "server.pem", "signing.key", "apns.p8",
      "release.keystore", "trust.jks", "id_rsa", "id_ed25519.pub",
      "gcp-credentials.json", "secrets.yaml", ".npmrc", ".netrc",
      "terraform.tfstate", "putty.ppk", "vault.kdbx",
    ]) {
      assert.strictEqual(isSensitiveFile(f), true, `${f} should be sensitive`);
    }
    for (const f of [
      "index.ts", "README.md", "package.json", "environment.ts",
      "key-codes.ts", "monkey.test.ts", "envelope.tsx",
    ]) {
      assert.strictEqual(isSensitiveFile(f), false, `${f} should NOT be sensitive`);
    }
  });
});

describe("file watcher DoS guard", () => {
  test("1 MB broadcast cap logic", () => {
    const overLimit = (size: number): boolean => size > 1024 * 1024;
    assert.strictEqual(overLimit(1024 * 1024 + 1), true);
    assert.strictEqual(overLimit(1024 * 1024), false);
  });
});
