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

describe("raw line preservation (#61)", () => {
  const gbMd = [
    "# anatomy.md", "",
    "> Auto-maintained by OpenWolf. Last scanned: t",
    "> Files: 1 tracked | Anatomy hits: 0 | Misses: 0", "",
    "## assets/models/", "",
    "- `base-model.safetensors` (~16GB) — pretrained backbone",
    "- `fine-tuned.safetensors` (~4GB) — our own fine-tune, NOT reproducible",
    "Free-form prose note under the section header.", "",
    "## src/", "",
    "- `index.ts` — Main entry point (~180 tok)", "",
  ].join("\n");

  test("non-tok bullets and prose survive import → render", () => {
    const dir = tmpDir();
    const store = newStore();
    importFromMarkdown(store, gbMd, dir);
    const rendered = renderStore(store);
    assert.ok(rendered.includes("- `base-model.safetensors` (~16GB) — pretrained backbone"));
    assert.ok(rendered.includes("- `fine-tuned.safetensors` (~4GB) — our own fine-tune, NOT reproducible"));
    assert.ok(rendered.includes("Free-form prose note under the section header."));
    assert.ok(rendered.includes("- `index.ts` — Main entry point (~180 tok)"));
  });

  test("raw lines are a fixed point across repeated round-trips", () => {
    const dir = tmpDir();
    const store = newStore();
    importFromMarkdown(store, gbMd, dir);
    const first = renderStore(store);
    importFromMarkdown(store, first, dir);
    const second = renderStore(store);
    assert.strictEqual(second, first);
  });

  test("tracked file count excludes raw lines", () => {
    const dir = tmpDir();
    const store = newStore();
    importFromMarkdown(store, gbMd, dir);
    saveStore(dir, store);
    assert.strictEqual(store.meta.fileCount, 1);
  });

  test("symbols never render into anatomy.md (they stay in the index)", () => {
    const store = sampleStore();
    store.files["src/index.ts"].symbols = [
      { name: "main", kind: "fn", startLine: 1, endLine: 40, tokens: 120 },
    ];
    const rendered = renderStore(store);
    assert.ok(!/^[ \t]+- /m.test(rendered), "rendered anatomy.md must contain no indented sub-bullets");
    assert.ok(!rendered.includes("`main`"), "symbol names must not appear in the render");
    // And the round-trip keeps the symbols in the store untouched.
    const reimported = newStore();
    importFromMarkdown(reimported, rendered, tmpDir());
    assert.strictEqual(reimported.rawLines, undefined);
  });
});

describe("preamble preservation (#61, laihenyi case)", () => {
  const preambleMd = `# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-01-01T00:00:00.000Z
> Files: 1 tracked | Anatomy hits: 0 | Misses: 0

## Goal contracts (curated, do not regenerate)

These describe the project's goal contracts, kept above the generated
sections because they are curated rather than scanned.

## src/

- \`index.ts\` — Main entry (~100 tok)
`;

  // Content above the FIRST ## heading, not inside any section.
  const pureTopMd = `# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-01-01T00:00:00.000Z
> Files: 1 tracked | Anatomy hits: 0 | Misses: 0

Curated project overview line one.
Curated line two, wrapped across lines with no token suffix.

## src/

- \`index.ts\` — Main entry (~100 tok)
`;

  test("preamble above the first section survives import → render", () => {
    const store = newStore();
    importFromMarkdown(store, pureTopMd, tmpDir());
    assert.deepStrictEqual(store.preamble, [
      "Curated project overview line one.",
      "Curated line two, wrapped across lines with no token suffix.",
    ]);
    const rendered = renderStore(store);
    assert.ok(rendered.includes("Curated project overview line one."));
    assert.ok(rendered.includes("Curated line two, wrapped across lines with no token suffix."));
  });

  test("preamble is a fixed point across repeated round-trips (no blank-line growth)", () => {
    const store = newStore();
    importFromMarkdown(store, pureTopMd, tmpDir());
    let md = renderStore(store);
    for (let i = 0; i < 3; i++) {
      const next = newStore();
      importFromMarkdown(next, md, tmpDir());
      const md2 = renderStore(next);
      assert.strictEqual(md2, md, `round-trip ${i + 1} changed the render`);
      md = md2;
    }
  });

  test("the auto-generated header is never captured as preamble", () => {
    const store = newStore();
    importFromMarkdown(store, preambleMd, tmpDir());
    assert.strictEqual(store.preamble, undefined);
    const rendered = renderStore(store);
    assert.strictEqual(
      (rendered.match(/# anatomy\.md/g) || []).length, 1,
      "header must not duplicate"
    );
  });

  test("empty/corrupt anatomy.md never wipes preserved content", () => {
    const store = newStore();
    importFromMarkdown(store, pureTopMd, tmpDir());
    assert.ok(store.preamble && store.preamble.length === 2);
    importFromMarkdown(store, "", tmpDir());
    assert.ok(store.preamble && store.preamble.length === 2, "empty md must not clear preamble");
  });

  test("hand-written indented bullets survive; legacy symbol sub-bullets are dropped", () => {
    const md = `# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: t
> Files: 1 tracked | Anatomy hits: 0 | Misses: 0

## src/

- \`index.ts\` — Main entry (~100 tok)
  - note: uses the legacy config loader, do not modernize
  - fn \`main\` L1-40 (~120 tok)
`;
    const store = newStore();
    importFromMarkdown(store, md, tmpDir());
    const raws = store.rawLines?.["src/"] ?? [];
    assert.ok(raws.includes("  - note: uses the legacy config loader, do not modernize"));
    assert.ok(!raws.some((l) => l.includes("L1-40")), "legacy symbol sub-bullets are mechanical output, dropped");
  });

  test("GB-unit bullets, prose, and preamble coexist across passes", () => {
    const md = `# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: t
> Files: 1 tracked | Anatomy hits: 0 | Misses: 0

Top-level curated note.

## assets/models/ (downloaded checkpoints, not git-tracked)

- \`base-model.safetensors\` (~16GB) — pretrained backbone
- \`fine-tuned.safetensors\` (~4GB) — our own fine-tune, NOT reproducible

## src/

- \`index.ts\` — Main entry (~100 tok)
`;
    const store = newStore();
    importFromMarkdown(store, md, tmpDir());
    let rendered = renderStore(store);
    const next = newStore();
    importFromMarkdown(next, rendered, tmpDir());
    rendered = renderStore(next);
    assert.ok(rendered.includes("Top-level curated note."));
    assert.ok(rendered.includes("(~16GB)"));
    assert.ok(rendered.includes("NOT reproducible"));
  });
});
