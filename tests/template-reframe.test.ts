import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// #135: 2.2+ no longer ships .wolf/reframe-frameworks.md, so /reframe must carry the KB itself.
test("reframe skill does not depend on .wolf/reframe-frameworks.md", () => {
  const skill = fs.readFileSync(path.join(import.meta.dirname, "../src/templates/skills/reframe.md"), "utf-8");
  assert.doesNotMatch(skill, /\.wolf\/reframe-frameworks\.md/);
  assert.match(skill, /# OpenWolf Reframe — UI Framework Knowledge Base/);
});
