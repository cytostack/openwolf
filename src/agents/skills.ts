import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { safeCopyFile } from "../utils/fs-safe.js";

// Bundled skills (Workstream H): shipped as markdown command templates and
// installed into each agent's project-level command surface on init.
//   Claude Code → .claude/commands/<name>.md   (slash command, $ARGUMENTS)
//   OpenCode    → .opencode/command/<name>.md  (custom command, $ARGUMENTS)
//   Codex       → .codex/prompts/<name>.md     (custom prompt)
// Gemini CLI and Cursor have no project-level command surface we target yet.

const SKILLS = ["security-audit", "reframe", "handoff"];

// Claude Code skills proper (auto-loaded on demand by description match, unlike
// slash commands): installed as .claude/skills/<name>/SKILL.md.
const CLAUDE_SKILLS: Array<{ name: string; template: string }> = [
  { name: "openwolf", template: "openwolf-protocol.md" },
];

// Hashes of command templates shipped by older releases. Retired commands
// are removed only when their bytes still match ours; customized files stay.
const RETIRED_SKILLS = [
  {
    name: "designqc",
    shippedHashes: new Set([
      "fb5066aac6fd7e5ad49f7ccffa586ee8579ee9ae3160abd60627e9ab0832e841",
    ]),
  },
];

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function removeRetiredSkills(
  destinations: Array<{ agent: string; dir: string }>,
  actions: string[],
): void {
  for (const { agent, dir } of destinations) {
    for (const retired of RETIRED_SKILLS) {
      const dest = path.join(dir, `${retired.name}.md`);
      if (!fs.existsSync(dest)) continue;

      const content = fs.readFileSync(dest);
      if (retired.shippedHashes.has(sha256(content))) {
        fs.unlinkSync(dest);
        actions.push(`Retired skill removed for ${agent}: /${retired.name}`);
      } else {
        actions.push(
          `Retired skill left untouched for ${agent} (customized): /${retired.name} (its OpenWolf command is no longer available)`,
        );
      }
    }
  }
}

export function installSkills(projectRoot: string, templatesDir: string, agents: string[]): string[] {
  const skillsDir = path.join(templatesDir, "skills");
  const destinations: Array<{ agent: string; dir: string }> = [];
  if (agents.includes("claude")) {
    destinations.push({ agent: "claude", dir: path.join(projectRoot, ".claude", "commands") });
  }
  if (agents.includes("opencode")) {
    destinations.push({ agent: "opencode", dir: path.join(projectRoot, ".opencode", "command") });
  }
  if (agents.includes("codex")) {
    destinations.push({ agent: "codex", dir: path.join(projectRoot, ".codex", "prompts") });
  }

  const actions: string[] = [];
  removeRetiredSkills(destinations, actions);
  if (!fs.existsSync(skillsDir)) return actions;

  // One line for all agents rather than one per agent: the skill set is
  // identical everywhere, and four near-identical lines pushed the useful
  // part of `openwolf init` off the top of the screen.
  const skillsInstalledFor: string[] = [];
  for (const { agent, dir } of destinations) {
    fs.mkdirSync(dir, { recursive: true });
    let installed = 0;
    const skipped: string[] = [];
    for (const skill of SKILLS) {
      const src = path.join(skillsDir, `${skill}.md`);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(dir, `${skill}.md`);
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
  for (const { name, template } of agents.includes("claude") ? CLAUDE_SKILLS : []) {
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
