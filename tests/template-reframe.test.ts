import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// #135: 2.2+ no longer ships .wolf/reframe-frameworks.md, so /reframe must carry the KB itself.
const dir = path.join(import.meta.dirname, "../src/templates");
const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8").replace(/\r\n/g, "\n");

test("reframe skill does not depend on .wolf/reframe-frameworks.md", () => {
  assert.doesNotMatch(read("skills/reframe.md"), /\.wolf\/reframe-frameworks\.md/);
});

test("reframe skill embeds the framework knowledge base verbatim", () => {
  assert.ok(read("skills/reframe.md").includes(read("reframe-frameworks.md").trim()));
});
