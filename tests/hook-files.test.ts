import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { HOOK_ENTRYPOINTS, listHookModules, resolveHookSourceDir } from "../src/utils/hook-files.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcHooksDir = path.resolve(here, "..", "src", "hooks");

/** Relative `./x.js` imports declared by a module. */
function localImports(source: string): string[] {
  const matches = source.matchAll(/from\s+"\.\/([\w-]+)\.js"/g);
  return [...new Set([...matches].map((m) => `${m[1]}.js`))];
}

/**
 * Mirror the real hooks directory as compiled `.js` files, preserving each
 * module's imports. Stands in for dist/hooks so the test needs no build step.
 */
function buildFakePackageHooks(dir: string): void {
  for (const tsFile of fs.readdirSync(srcHooksDir).filter((f) => f.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(srcHooksDir, tsFile), "utf-8");
    const imports = localImports(source).map((m) => `export * from "./${m}";`).join("\n");
    fs.writeFileSync(path.join(dir, tsFile.replace(/\.ts$/, ".js")), `${imports}\nexport {};\n`);
  }
}

/** Walk an entrypoint's imports transitively, collecting anything unresolved. */
function unresolvedImports(installDir: string, entrypoint: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  const queue = [entrypoint];

  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const modulePath = path.join(installDir, current);
    if (!fs.existsSync(modulePath)) {
      missing.push(current);
      continue;
    }
    queue.push(...localImports(fs.readFileSync(modulePath, "utf-8")));
  }
  return missing;
}

describe("hook module installation", () => {
  test("installing what listHookModules reports leaves every import resolvable", () => {
    // Regression guard for 2.0.x: init and update copied a hardcoded list of
    // filenames. symbol-extractor.js was added to the hooks directory but never
    // to that list, so every install shipped a post-write.js that died with
    // ERR_MODULE_NOT_FOUND on the first Write — silently, since the harness
    // swallows hook stderr and `openwolf status` only checked the entrypoints.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-install-"));
    const packageHooks = path.join(root, "package-hooks");
    const installDir = path.join(root, "install");
    fs.mkdirSync(packageHooks);
    fs.mkdirSync(installDir);

    try {
      buildFakePackageHooks(packageHooks);

      // This is exactly what init/update do to populate .wolf/hooks/.
      for (const file of listHookModules(packageHooks)) {
        fs.copyFileSync(path.join(packageHooks, file), path.join(installDir, file));
      }

      for (const entrypoint of HOOK_ENTRYPOINTS) {
        assert.deepStrictEqual(
          unresolvedImports(installDir, entrypoint),
          [],
          `${entrypoint} has imports missing from the install`
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("listHookModules returns every compiled module, not a fixed subset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-hooks-"));
    try {
      const files = ["shared.js", "post-write.js", "brand-new-helper.js"];
      for (const f of files) fs.writeFileSync(path.join(dir, f), "export {};\n");
      fs.writeFileSync(path.join(dir, "notes.md"), "not a module\n");

      assert.deepStrictEqual(listHookModules(dir), [...files].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("listHookModules tolerates a missing or unresolved source directory", () => {
    assert.deepStrictEqual(listHookModules(""), []);
    assert.deepStrictEqual(listHookModules(path.join(os.tmpdir(), "openwolf-does-not-exist")), []);
  });

  test("resolveHookSourceDir returns empty string when no candidate has shared.js", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-nohooks-"));
    try {
      assert.strictEqual(resolveHookSourceDir(dir), "");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every declared entrypoint exists in src/hooks", () => {
    for (const entrypoint of HOOK_ENTRYPOINTS) {
      const tsFile = path.join(srcHooksDir, entrypoint.replace(/\.js$/, ".ts"));
      assert.ok(fs.existsSync(tsFile), `missing source for entrypoint ${entrypoint}`);
    }
  });
});
