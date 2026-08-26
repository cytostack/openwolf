import * as assert from "node:assert";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";

const registryUrl = pathToFileURL(path.resolve(import.meta.dirname, "../dist/src/cli/registry.js")).href;

interface ChildResult {
  code: number;
  stderr: string;
}

function isolatedHome(t: { after: (fn: () => void) => void }): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-registry-lock-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function runChild(home: string, script: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, stderr: error.message }));
    child.once("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

function assertChildrenSucceeded(results: ChildResult[]): void {
  assert.deepStrictEqual(
    results.map(({ code }) => code),
    Array(results.length).fill(0),
    results.map(({ code, stderr }, index) => `child ${index}: exit ${code}\n${stderr}`).join("\n")
  );
}

function registerScript(root: string, index: number): string {
  return `
    const registry = await import(${JSON.stringify(registryUrl)});
    registry.registerProject(${JSON.stringify(root)}, ${JSON.stringify(`project-${index}`)}, "1.0.0");
  `;
}

function unregisterScript(root: string): string {
  return `
    const registry = await import(${JSON.stringify(registryUrl)});
    registry.unregisterProject(${JSON.stringify(root)});
  `;
}

function registryAt(home: string): { version: number; projects: Array<{ root: string }> } {
  return JSON.parse(fs.readFileSync(path.join(home, ".openwolf", "registry.json"), "utf8"));
}

describe("registry lock", () => {
  test("issue #7: concurrent registry update lost", async (t) => {
    const home = isolatedHome(t);
    const roots = Array.from({ length: 60 }, (_, index) => `/projects/register-${index}`);
    const results = await Promise.all(roots.map((root, index) => runChild(home, registerScript(root, index))));

    assertChildrenSucceeded(results);
    const registry = registryAt(home);
    assert.strictEqual(registry.version, 1);
    assert.deepStrictEqual(registry.projects.map(({ root }) => root).sort(), roots.sort());
  });

  test("issue #7: concurrent registry removal lost", async (t) => {
    const home = isolatedHome(t);
    const roots = Array.from({ length: 60 }, (_, index) => `/projects/unregister-${index}`);
    const seed = `
      const registry = await import(${JSON.stringify(registryUrl)});
      for (const [index, root] of ${JSON.stringify(roots)}.entries()) {
        registry.registerProject(root, \`project-\${index}\`, "1.0.0");
      }
    `;

    assertChildrenSucceeded([await runChild(home, seed)]);
    const results = await Promise.all(roots.slice(0, 30).map((root) => runChild(home, unregisterScript(root))));

    assertChildrenSucceeded(results);
    assert.deepStrictEqual(
      registryAt(home).projects.map(({ root }) => root).sort(),
      roots.slice(30).sort()
    );
  });

  test("acquires the registry lock through the public registration boundary", async (t) => {
    const home = isolatedHome(t);
    const expected = path.join(home, ".openwolf", "registry.json.lock");
    const acquisitions: Array<{ target: string; flag: string }> = [];
    const originalWriteFileSync = fs.writeFileSync;
    const originalHome = process.env.HOME;

    process.env.HOME = home;
    fs.writeFileSync = ((...args: any[]) => {
      const [target, , options] = args;
      const flag = typeof options === "object" && options !== null ? options.flag : undefined;
      if (target === expected && flag === "wx") acquisitions.push({ target, flag });
      return originalWriteFileSync.apply(fs, args as Parameters<typeof originalWriteFileSync>);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();

    try {
      const registry = await import(`${registryUrl}?audit=${Date.now()}`);
      registry.registerProject("/projects/spy", "spy", "1.0.0");
      assert.deepStrictEqual(acquisitions, [{ target: expected, flag: "wx" }]);
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      syncBuiltinESMExports();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
