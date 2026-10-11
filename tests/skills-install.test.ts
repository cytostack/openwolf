import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installSkills } from "../dist/src/agents/skills.js";

// #135: a skill file we installed earlier and the user never touched must follow template updates;
// a file the user edited must never be overwritten.

// handoff.md as shipped in 1903334 (before the install manifest existed).
const SHIPPED_BEFORE_MANIFEST = "Regenerate `.wolf/STATUS.md` as a session handoff document. $ARGUMENTS\n\nBuild it from the session's actual state, not from memory of the conversation alone:\n\n1. Read the current `.wolf/STATUS.md` to preserve its structure and any still-relevant open items.\n2. Run `git status --short` and `git log --oneline -8` to see what actually changed.\n3. Skim the latest session block of `.wolf/memory.md` for the action log.\n\nThen rewrite `.wolf/STATUS.md` with:\n\n- `## \u2705 Done` : what this session completed, one line each, concrete (files, features, fixes). Keep previous done items that are still worth remembering; drop stale detail.\n- `## \ud83d\ude80 Next quest` : the single next objective, the files involved, acceptance criteria, and any open decisions the user still needs to make.\n- `## Context` : 2-4 lines a fresh session needs (branch state, blocked items, environment quirks).\n- Bump the date.\n\nKeep the whole file under ~2k tokens: it must be cheaper to read than reconstructing context from scratch. Do not pad it; a short honest handoff beats a complete-looking one.\n";

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-skills-"));
  const templates = path.join(root, "templates");
  fs.mkdirSync(path.join(templates, "skills"), { recursive: true });
  fs.mkdirSync(path.join(root, ".wolf"));
  const setTemplate = (text: string) => fs.writeFileSync(path.join(templates, "skills", "handoff.md"), text);
  const dest = path.join(root, ".claude", "commands", "handoff.md");
  return { root, templates, setTemplate, dest, run: () => installSkills(root, templates, ["claude"]) };
}

test("updates a prior shipped version that predates the manifest", () => {
  const p = project();
  p.setTemplate("new\n");
  fs.mkdirSync(path.dirname(p.dest), { recursive: true });
  fs.writeFileSync(p.dest, SHIPPED_BEFORE_MANIFEST);
  p.run();
  assert.equal(fs.readFileSync(p.dest, "utf-8"), "new\n");
});

test("leaves a user-edited file alone and says so", () => {
  const p = project();
  p.setTemplate("new\n");
  fs.mkdirSync(path.dirname(p.dest), { recursive: true });
  fs.writeFileSync(p.dest, "mine\n");
  const actions = p.run();
  assert.equal(fs.readFileSync(p.dest, "utf-8"), "mine\n");
  assert.match(actions.join("\n"), /customized/);
});

test("follows template updates after install, until the user edits the file", () => {
  const p = project();
  p.setTemplate("v1\n");
  p.run();
  p.setTemplate("v2\n");
  p.run();
  assert.equal(fs.readFileSync(p.dest, "utf-8"), "v2\n");
  fs.writeFileSync(p.dest, "v2 edited\n");
  p.setTemplate("v3\n");
  p.run();
  assert.equal(fs.readFileSync(p.dest, "utf-8"), "v2 edited\n");
});
