import { test, describe } from "node:test";
import * as assert from "node:assert";

import { parseAnatomy } from "../src/hooks/anatomy-store.ts";

/**
 * anatomy.md is re-rendered from whatever parseAnatomy() understands, and importFromMarkdown()
 * reads hand-edits through the same parser. An entry the regex cannot match is therefore not
 * merely ignored — it is deleted on the next render, taking any curated description with it.
 *
 * The original pattern required BOTH an em-dash separator AND a trailing "(~N tok)", so an
 * entry written with a plain hyphen, or without a token estimate, silently vanished.
 */
describe("parseAnatomy tolerance", () => {
  const md = [
    "# anatomy.md",
    "",
    "## scripts/",
    "",
    "- `emdash.py` — canonical shape (~120 tok)",
    "- `hyphen.py` - plain hyphen separator (~120 tok)",
    "- `endash.py` – en dash separator (~120 tok)",
    "- `colon.py`: colon separator (~120 tok)",
    "- `notok.py` — no token estimate",
    "- `bare.py` (~55 tok)",
    "",
  ].join("\n");

  const sections = parseAnatomy(md);
  const entries = sections.get("scripts/") ?? [];
  const byFile = new Map(entries.map((e) => [e.file, e]));

  test("keeps every reasonable entry shape", () => {
    assert.equal(entries.length, 6, `expected 6 entries, got ${entries.length}`);
  });

  for (const f of ["emdash.py", "hyphen.py", "endash.py", "colon.py", "notok.py", "bare.py"]) {
    test(`keeps ${f}`, () => assert.ok(byFile.has(f), `${f} was dropped by the parser`));
  }

  test("preserves the description text", () => {
    assert.equal(byFile.get("hyphen.py")?.description, "plain hyphen separator");
    assert.equal(byFile.get("notok.py")?.description, "no token estimate");
  });

  test("treats a missing token estimate as zero rather than dropping the entry", () => {
    assert.equal(byFile.get("notok.py")?.tokens, 0);
  });

  test("an entry with no description still parses", () => {
    assert.equal(byFile.get("bare.py")?.description, "");
    assert.equal(byFile.get("bare.py")?.tokens, 55);
  });

  test("descriptions containing separators and parentheses survive intact", () => {
    const tricky = parseAnatomy(
      "## s/\n\n- `x.py` — does A — then B (see notes): done (~10 tok)\n"
    ).get("s/")![0];
    assert.equal(tricky.description, "does A — then B (see notes): done");
    assert.equal(tricky.tokens, 10);
  });
});
