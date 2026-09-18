import * as fs from "node:fs";
import * as path from "node:path";
import { safeCopyFile } from "../utils/fs-safe.js";

// Bundled skills (Workstream H): shipped as markdown command templates and
// installed into each agent's project-level command surface on init.
//   Claude Code → .claude/commands/<name>.md   (slash command, $ARGUMENTS)
//   OpenCode    → .opencode/command/<name>.md  (custom command, $ARGUMENTS)
//   Codex       → .codex/prompts/<name>.md     (custom prompt)
//   Pi and OMP  → .agents/skills/<name>/SKILL.md (shared Agent Skills)
// Gemini CLI and Cursor have no project-level command surface we target yet.

const SKILLS = ["security-audit", "reframe", "designqc", "handoff"];

// Claude Code skills proper (auto-loaded on demand by description match, unlike
// slash commands): installed as .claude/skills/<name>/SKILL.md.
const CLAUDE_SKILLS: Array<{ name: string; template: string }> = [
  { name: "openwolf", template: "openwolf-protocol.md" },
];

export function installSkills(projectRoot: string, templatesDir: string, agents: string[]): string[] {
  const skillsDir = path.join(templatesDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const destinations: Array<{ agent: string; dir: string; nestedSkill: boolean }> = [
    { agent: "claude", dir: path.join(projectRoot, ".claude", "commands"), nestedSkill: false },
  ];
  if (agents.includes("opencode")) {
    destinations.push({ agent: "opencode", dir: path.join(projectRoot, ".opencode", "command"), nestedSkill: false });
  }
  if (agents.includes("codex")) {
    destinations.push({ agent: "codex", dir: path.join(projectRoot, ".codex", "prompts"), nestedSkill: false });
  }
  if (agents.includes("pi") || agents.includes("omp")) {
    destinations.push({ agent: "pi/omp", dir: path.join(projectRoot, ".agents", "skills"), nestedSkill: true });
  }

  const actions: string[] = [];
  // One line for all agents rather than one per agent: the skill set is
  // identical everywhere, and four near-identical lines pushed the useful
  // part of `openwolf init` off the top of the screen.
  const skillsInstalledFor: string[] = [];
  for (const { agent, dir, nestedSkill } of destinations) {
    fs.mkdirSync(dir, { recursive: true });
    let installed = 0;
    const skipped: string[] = [];
    for (const skill of SKILLS) {
      const src = path.join(skillsDir, `${skill}.md`);
      if (!fs.existsSync(src)) continue;
      const dest = nestedSkill
        ? path.join(dir, skill, "SKILL.md")
        : path.join(dir, `${skill}.md`);
      // Idempotency contract (types.ts): never clobber a file the user has
      // customized. Overwrite only when missing or identical to our template;
      // a differing file is theirs now — skip it and say so.
      if (fs.existsSync(dest)) {
        const existing = fs.readFileSync(dest, "utf-8");
        const template = fs.readFileSync(src, "utf-8");
        if (existing !== template) {
          skipped.push(`/${skill}`);
          continue;
        }
      }
      safeCopyFile(src, dest);
      installed++;
    }
    if (installed > 0) {
      skillsInstalledFor.push(agent);
    }
    if (skipped.length > 0) {
      actions.push(`Skills left untouched for ${agent} (customized): ${skipped.join(", ")} (delete the file to get the updated template)`);
    }
  }

  if (skillsInstalledFor.length > 0) {
    actions.push(
      `Skills installed: ${SKILLS.map((sk) => `/${sk}`).join(", ")} (${skillsInstalledFor.join(", ")})`
    );
  }

  // Claude Code skills: same never-clobber-customized contract.
  const installedSkills: string[] = [];
  for (const { name, template } of CLAUDE_SKILLS) {
    const src = path.join(skillsDir, template);
    if (!fs.existsSync(src)) continue;
    const destDir = path.join(projectRoot, ".claude", "skills", name);
    const dest = path.join(destDir, "SKILL.md");
    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf-8");
      const templateContent = fs.readFileSync(src, "utf-8");
      if (existing !== templateContent) {
        actions.push(`Skill left untouched (customized): ${name} (delete .claude/skills/${name}/SKILL.md to get the updated template)`);
        continue;
      }
    }
    fs.mkdirSync(destDir, { recursive: true });
    safeCopyFile(src, dest);
    installedSkills.push(name);
  }
  if (installedSkills.length > 0) {
    actions.push(`Claude skills installed: ${installedSkills.join(", ")} (.claude/skills/)`);
  }

  return actions;
}
