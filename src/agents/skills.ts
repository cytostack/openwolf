import * as fs from "node:fs";
import * as path from "node:path";
import { safeCopyFile } from "../utils/fs-safe.js";

// Bundled skills (Workstream H): shipped as markdown command templates and
// installed into each agent's project-level command surface on init.
//   Claude Code → .claude/commands/<name>.md   (slash command, $ARGUMENTS)
//   OpenCode    → .opencode/command/<name>.md  (custom command, $ARGUMENTS)
//   Codex       → .codex/prompts/<name>.md     (custom prompt)
// Gemini CLI and Cursor have no project-level command surface we target yet.

const SKILLS = ["security-audit", "reframe"];

export function installSkills(projectRoot: string, templatesDir: string, agents: string[]): string[] {
  const skillsDir = path.join(templatesDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const destinations: Array<{ agent: string; dir: string }> = [
    { agent: "claude", dir: path.join(projectRoot, ".claude", "commands") },
  ];
  if (agents.includes("opencode")) {
    destinations.push({ agent: "opencode", dir: path.join(projectRoot, ".opencode", "command") });
  }
  if (agents.includes("codex")) {
    destinations.push({ agent: "codex", dir: path.join(projectRoot, ".codex", "prompts") });
  }

  const actions: string[] = [];
  for (const { agent, dir } of destinations) {
    fs.mkdirSync(dir, { recursive: true });
    let installed = 0;
    for (const skill of SKILLS) {
      const src = path.join(skillsDir, `${skill}.md`);
      if (!fs.existsSync(src)) continue;
      safeCopyFile(src, path.join(dir, `${skill}.md`));
      installed++;
    }
    if (installed > 0) {
      actions.push(`Skills installed for ${agent}: ${SKILLS.map((s) => `/${s}`).join(", ")}`);
    }
  }
  return actions;
}
