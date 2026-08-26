import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);

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

  test("repairs accepted existing dashboard token mode", { skip: process.platform === "win32" }, async () => {
    const { getDashboardToken } = await import("../src/utils/dashboard-auth.ts");
    const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-sec-"));
    const tokenPath = path.join(wolfDir, "dashboard-token");
    const token = "a".repeat(64);
    const tokenBytes = `${token}\n`;
    try {
      fs.writeFileSync(tokenPath, tokenBytes, { mode: 0o600 });
      fs.chmodSync(tokenPath, 0o644);

      assert.strictEqual(getDashboardToken(wolfDir), token);
      assert.strictEqual(fs.readFileSync(tokenPath, "utf-8"), tokenBytes);
      assert.strictEqual(fs.statSync(tokenPath).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(wolfDir, { recursive: true, force: true });
    }
  });

  test("surfaces accepted-token permission repair failures without replacing the token", async () => {
    const { getDashboardToken } = await import("../src/utils/dashboard-auth.ts");
    const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-sec-"));
    const tokenPath = path.join(wolfDir, "dashboard-token");
    const token = "b".repeat(64);
    const tokenBytes = `${token}\n`;
    const fsRequire = require("node:fs") as typeof fs;
    const cryptoRequire = require("node:crypto") as typeof crypto;
    const originalChmodSync = fsRequire.chmodSync;
    const originalWriteFileSync = fsRequire.writeFileSync;
    const originalRandomBytes = cryptoRequire.randomBytes;
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const permissionError = new Error("permission repair failed");
    let writeCalls = 0;
    let randomCalls = 0;
    if (!platformDescriptor) throw new Error("process.platform descriptor is unavailable");

    try {
      fs.writeFileSync(tokenPath, tokenBytes, { mode: 0o600 });
      Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
      fsRequire.chmodSync = ((filePath: fs.PathLike, mode: fs.Mode) => {
        if (filePath === tokenPath && mode === 0o600) throw permissionError;
        return originalChmodSync(filePath, mode);
      }) as typeof fs.chmodSync;
      fsRequire.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
        writeCalls++;
        return originalWriteFileSync(...args);
      }) as typeof fs.writeFileSync;
      cryptoRequire.randomBytes = ((...args: Parameters<typeof crypto.randomBytes>) => {
        randomCalls++;
        return originalRandomBytes(...args);
      }) as typeof crypto.randomBytes;
      syncBuiltinESMExports();

      assert.throws(() => getDashboardToken(wolfDir), (error: unknown) => error === permissionError);
      assert.strictEqual(fs.readFileSync(tokenPath, "utf-8"), tokenBytes);
      assert.strictEqual(writeCalls, 0);
      assert.strictEqual(randomCalls, 0);
    } finally {
      fsRequire.chmodSync = originalChmodSync;
      fsRequire.writeFileSync = originalWriteFileSync;
      cryptoRequire.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
      Object.defineProperty(process, "platform", platformDescriptor);
      fs.rmSync(wolfDir, { recursive: true, force: true });
    }
  });

  test("keeps accepted dashboard tokens unchanged on Windows without chmod", async () => {
    const { getDashboardToken } = await import("../src/utils/dashboard-auth.ts");
    const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-sec-"));
    const tokenPath = path.join(wolfDir, "dashboard-token");
    const token = "c".repeat(64);
    const tokenBytes = `${token}\n`;
    const fsRequire = require("node:fs") as typeof fs;
    const originalChmodSync = fsRequire.chmodSync;
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    let chmodCalls = 0;
    if (!platformDescriptor) throw new Error("process.platform descriptor is unavailable");

    try {
      fs.writeFileSync(tokenPath, tokenBytes, { mode: 0o600 });
      Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
      fsRequire.chmodSync = ((...args: Parameters<typeof fs.chmodSync>) => {
        chmodCalls++;
        return originalChmodSync(...args);
      }) as typeof fs.chmodSync;
      syncBuiltinESMExports();

      assert.strictEqual(getDashboardToken(wolfDir), token);
      assert.strictEqual(fs.readFileSync(tokenPath, "utf-8"), tokenBytes);
      assert.strictEqual(chmodCalls, 0);
    } finally {
      fsRequire.chmodSync = originalChmodSync;
      syncBuiltinESMExports();
      Object.defineProperty(process, "platform", platformDescriptor);
      fs.rmSync(wolfDir, { recursive: true, force: true });
    }
  });

  test("replaces an invalid existing dashboard token", async () => {
    const { getDashboardToken } = await import("../src/utils/dashboard-auth.ts");
    const wolfDir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-sec-"));
    const tokenPath = path.join(wolfDir, "dashboard-token");
    const invalidToken = "invalid-dashboard-token";
    try {
      fs.writeFileSync(tokenPath, `${invalidToken}\n`, { mode: 0o600 });

      const token = getDashboardToken(wolfDir);
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.notStrictEqual(token, invalidToken);
    } finally {
      fs.rmSync(wolfDir, { recursive: true, force: true });
    }
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
