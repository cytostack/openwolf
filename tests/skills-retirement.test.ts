import { describe, test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installSkills } from "../src/agents/skills.ts";

const SHIPPED_DESIGNQC_TEMPLATE = `---
description: Screenshot-based design review of the running app via openwolf designqc
argument-hint: [--url <url>] [--routes <routes>]
---

Arguments: $ARGUMENTS

Evaluate and improve the design/UI of this app:

1. Run \`openwolf designqc\` via Bash to capture screenshots (pass through any arguments given above).
   - The command auto-detects a running dev server, or starts one from package.json if needed.
   - Use \`--url <url>\` only if auto-detection fails.
   - Compressed JPEG screenshots land in \`.wolf/designqc-captures/\`; full pages are captured as sectioned viewport-height images (top, section2, ..., bottom).
2. Read the captured screenshots from \`.wolf/designqc-captures/\` with the Read tool.
3. Evaluate against modern standards (Shadcn UI, Tailwind, clean React patterns):
   - Spacing and whitespace consistency
   - Typography hierarchy and readability
   - Color contrast and accessibility (WCAG)
   - Visual hierarchy and focal points
   - Component consistency
   - Whether the design looks generic ("white-coded", no personality)
4. Provide specific, actionable feedback with fix suggestions.
5. If the user approves, implement the fixes directly in their code.
6. Re-run \`openwolf designqc\` to verify the improvement.

Token awareness: each screenshot costs about 2,500 tokens. For large apps, use \`--routes / /specific-page\` to limit captures.
`;

function fixture(): { root: string; templates: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ow-retired-skill-"));
  const templates = path.join(root, "templates");
  fs.mkdirSync(path.join(templates, "skills"), { recursive: true });
  return { root, templates };
}

describe("retired skill migration", () => {
  test("removes byte-identical DesignQC commands for every configured agent", () => {
    const { root, templates } = fixture();
    const files = [
      path.join(root, ".claude", "commands", "designqc.md"),
      path.join(root, ".codex", "prompts", "designqc.md"),
      path.join(root, ".opencode", "command", "designqc.md"),
    ];
    for (const file of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, SHIPPED_DESIGNQC_TEMPLATE);
    }

    const actions = installSkills(root, templates, ["claude", "codex", "opencode"]);

    for (const file of files) assert.strictEqual(fs.existsSync(file), false);
    assert.strictEqual(actions.filter((line) => line.includes("Retired skill removed")).length, 3);
  });

  test("preserves customized retired commands and reports why", () => {
    const { root, templates } = fixture();
    const file = path.join(root, ".claude", "commands", "designqc.md");
    const customized = SHIPPED_DESIGNQC_TEMPLATE + "\nCustom project instructions.\n";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, customized);

    const actions = installSkills(root, templates, ["claude"]);

    assert.strictEqual(fs.readFileSync(file, "utf-8"), customized);
    assert.ok(actions.some((line) => line.includes("left untouched") && line.includes("/designqc")));
  });
});
