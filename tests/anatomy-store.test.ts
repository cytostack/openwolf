import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  newStore, saveStore, loadStore, loadStoreReconciled, renderStore, renderToFile,
  importFromMarkdown, parseAnatomy, sha256, lookupEntry, STORE_FILE,
} from "../src/hooks/anatomy-store.ts";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "wolf-anat-"));

function sampleStore() {
  const store = newStore();
  store.meta.lastScanned = "2026-07-15T00:00:00.000Z";
  store.files["src/index.ts"] = { description: "Main entry point", tokens: 180, updatedAt: "x", source: "scan" };
  store.files["src/api/auth.ts"] = { description: "JWT middleware", tokens: 340, updatedAt: "x", source: "scan" };
  store.files["README.md"] = { description: "", tokens: 900, updatedAt: "x", source: "scan" };
  return store;
}

describe("anatomy store", () => {
  test("save/load round-trip is lossless", () => {
    const dir = tmpDir();
    const store = sampleStore();
    saveStore(dir, store);
    const loaded = loadStore(dir);
    assert.ok(loaded);
    assert.deepStrictEqual(loaded!.files, store.files);
    assert.strictEqual(loaded!.meta.fileCount, 3);
  });

  test("corrupt store returns null; reconciled loader bootstraps from anatomy.md", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, STORE_FILE), "{not json", "utf-8");
    assert.strictEqual(loadStore(dir), null);
    fs.writeFileSync(path.join(dir, "anatomy.md"), renderStore(sampleStore()), "utf-8");
    const recovered = loadStoreReconciled(dir, dir);
    assert.strictEqual(Object.keys(recovered.files).length, 3);
    assert.strictEqual(recovered.files["src/api/auth.ts"].description, "JWT middleware");
  });

  test("render is byte-identical to the legacy format (golden)", () => {
    const rendered = renderStore(sampleStore());
    const expected = [
      "# anatomy.md",
      "",
      "> Auto-maintained by OpenWolf. Last scanned: 2026-07-15T00:00:00.000Z",
      "> Files: 3 tracked | Anatomy hits: 0 | Misses: 0",
      "",
      "## ./",
      "",
      "- `README.md` (~900 tok)",
      "",
      "## src/",
      "",
      "- `index.ts` — Main entry point (~180 tok)",
      "",
      "## src/api/",
      "",
      "- `auth.ts` — JWT middleware (~340 tok)",
      "",
    ].join("\n");
    assert.strictEqual(rendered, expected);
  });

  test("parse(render(store)) preserves every entry", () => {
    const sections = parseAnatomy(renderStore(sampleStore()));
    const flat = [...sections.values()].flat();
    assert.strictEqual(flat.length, 3);
    assert.ok(flat.some((e) => e.file === "auth.ts" && e.tokens === 340));
  });
});

describe("markdown import (reconciliation)", () => {
  test("md wins description; unknown md entries added; missing-but-alive entries kept", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/kept.ts"), "export {}", "utf-8");

    const store = newStore();
    store.files["src/kept.ts"] = { description: "old desc", tokens: 10, updatedAt: "x", source: "hook" };
    store.files["src/gone.ts"] = { description: "dead", tokens: 5, updatedAt: "x", source: "hook" };

    const md = [
      "# anatomy.md", "",
      "> Auto-maintained by OpenWolf. Last scanned: t",
      "> Files: 2 tracked | Anatomy hits: 0 | Misses: 0", "",
      "## src/", "",
      "- `kept.ts` — HAND EDITED (~10 tok)",
      "- `brandnew.ts` — from old hook (~77 tok)", "",
    ].join("\n");

    importFromMarkdown(store, md, dir);
    assert.strictEqual(store.files["src/kept.ts"].description, "HAND EDITED");
    assert.strictEqual(store.files["src/brandnew.ts"].tokens, 77);
    assert.strictEqual(store.files["src/brandnew.ts"].source, "md-import");
    assert.ok(!("src/gone.ts" in store.files), "file gone from disk AND md is dropped");
  });

  test("render → import → render is a fixed point", () => {
    const dir = tmpDir();
    const store = sampleStore();
    const first = renderStore(store);
    importFromMarkdown(store, first, dir);
    const second = renderStore(store);
    assert.strictEqual(second, first);
  });

  test("diverged md is absorbed via loadStoreReconciled (renderedHash mismatch)", () => {
    const dir = tmpDir();
    const store = sampleStore();
    renderToFile(dir, store);
    saveStore(dir, store);
    // Simulate an old compiled hook / human editing the md out-of-band:
    const edited = fs.readFileSync(path.join(dir, "anatomy.md"), "utf-8")
      .replace("Main entry point", "EDITED BY OLD HOOK");
    fs.writeFileSync(path.join(dir, "anatomy.md"), edited, "utf-8");
    const reconciled = loadStoreReconciled(dir, dir);
    assert.strictEqual(reconciled.files["src/index.ts"].description, "EDITED BY OLD HOOK");
  });
});

describe("lookupEntry", () => {
  test("store-first O(1) hit, suffix fallback, and md fallback all resolve", () => {
    const dir = tmpDir();
    const store = sampleStore();
    saveStore(dir, store);
    const proj = "/Users/someone/proj";
    const hit = lookupEntry(dir, proj, `${proj}/src/api/auth.ts`);
    assert.ok(hit && hit.tokens === 340 && hit.file === "auth.ts");

    // md fallback: no store present
    const dir2 = tmpDir();
    fs.writeFileSync(path.join(dir2, "anatomy.md"), renderStore(sampleStore()), "utf-8");
    const hit2 = lookupEntry(dir2, proj, `${proj}/src/index.ts`);
    assert.ok(hit2 && hit2.tokens === 180);

    assert.strictEqual(lookupEntry(dir, proj, `${proj}/src/nope.ts`), null);
  });
});
