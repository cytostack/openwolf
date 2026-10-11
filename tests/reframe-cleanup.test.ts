import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { removeDeadWeight } from "../dist/src/cli/update.js";

// #135: reframe-frameworks.md lives only inside the /reframe skill now; the 2.2 cleanup still
// removes projects' untouched legacy copy (identified by hash of every shipped version).
const skill = fs.readFileSync(path.join(import.meta.dirname, "../src/templates/skills/reframe.md"), "utf-8").replace(/\r\n/g, "\n");
const KB = skill.slice(skill.indexOf("# OpenWolf Reframe — UI Framework Knowledge Base"));

function wolfWith(content: string) {
  const wolf = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-dead-"));
  const file = path.join(wolf, "reframe-frameworks.md");
  fs.writeFileSync(file, content);
  return { wolf, file };
}

test("removes an untouched legacy reframe-frameworks.md", () => {
  const { wolf, file } = wolfWith(KB);
  assert.match(removeDeadWeight(wolf).join("\n"), /reframe-frameworks\.md/);
  assert.equal(fs.existsSync(file), false);
});

test("keeps a user-edited reframe-frameworks.md", () => {
  const { wolf, file } = wolfWith(KB + "\nmy notes\n");
  removeDeadWeight(wolf);
  assert.equal(fs.existsSync(file), true);
});
