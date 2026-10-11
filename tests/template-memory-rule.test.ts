import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// #134: hook-equipped agents must not be told to hand-write memory.md at session end.
const templates = ["skills/openwolf-protocol.md", "OPENWOLF.md"];

for (const rel of templates) {
  test(`${rel}: session-end memory.md write is gated on missing hooks`, () => {
    const text = fs.readFileSync(path.join(import.meta.dirname, "../src/templates", rel), "utf-8");
    const line = text.split("\n").find((l) => l.startsWith("Before wrapping up"));
    assert.ok(line, "session-end line present");
    if (line.includes("memory.md")) assert.match(line, /no OpenWolf hooks/);
  });
}
