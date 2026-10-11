import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { readJSON, safeCopyFile, writeJSON } from "../utils/fs-safe.js";

// Bundled skills (Workstream H): shipped as markdown command templates and
// installed into each agent's project-level command surface on init.
//   Claude Code → .claude/commands/<name>.md   (slash command, $ARGUMENTS)
//   OpenCode    → .opencode/command/<name>.md  (custom command, $ARGUMENTS)
//   Codex       → .codex/prompts/<name>.md     (custom prompt)
// Gemini CLI and Cursor have no project-level command surface we target yet.

const SKILLS = ["security-audit", "reframe", "designqc", "handoff"];

// Claude Code skills proper (auto-loaded on demand by description match, unlike
// slash commands): installed as .claude/skills/<name>/SKILL.md.
const CLAUDE_SKILLS: Array<{ name: string; template: string }> = [
  { name: "openwolf", template: "openwolf-protocol.md" },
];

// Never clobber a file the user customized (types.ts idempotency contract), but
// do follow template updates for files they never touched. A file is ours when
// it matches the current template, the hash recorded when we last installed it
// (.wolf/skills-manifest.json), or a template shipped before that manifest
// existed (LEGACY_SHA256). Anything else is the user's now.
const MANIFEST = path.join(".wolf", "skills-manifest.json");

// sha256 (LF-normalised) of every skill template shipped before the manifest.
const LEGACY_SHA256 = new Set([
  "17a75695be5d46294e88596323a0b3d31ba68cd8970bdfd7733312a53c6f7594", // reframe
  "e6f7e0b7337c9c86e74f6bf2e75110278e52be3d89703e22c2126b3433b1c6c1", // security-audit
  "fb5066aac6fd7e5ad49f7ccffa586ee8579ee9ae3160abd60627e9ab0832e841", // designqc
  "11dcc188e5346c84015a9e3206b8c854ff1cb8eab4aad4079bbf16f6276bb1c3", // handoff
  "373cc8b1b9a24b762431e54479d2e052d51b07de2bb2dcf1b1e0aad4af526127", // handoff (2.4)
  "dbd292fb1e299898bb2f214a7addea8ee551d9680c8719c76df0ccfe4cbe57c3", // openwolf-protocol
  "53a07e0dd6c6e0700756d8d9e8e84525e32671b0a4a409fbfd4b67d6e70179ad", // openwolf-protocol
  "37fd73b865562ca6d1489b58f560cb29a1fa45c623c9d2e6ba2fab7121a5ee2f", // openwolf-protocol (2.4)
]);

const sha256 = (text: string): string =>
  crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** Copy src to dest unless dest is user-customized. Returns whether it was written. */
function placeSkill(projectRoot: string, src: string, dest: string, manifest: Record<string, string>): boolean {
  const template = sha256(fs.readFileSync(src, "utf-8"));
  const key = path.relative(projectRoot, dest).split(path.sep).join("/");
  if (fs.existsSync(dest)) {
    const existing = sha256(fs.readFileSync(dest, "utf-8"));
    if (existing !== template && existing !== manifest[key] && !LEGACY_SHA256.has(existing)) return false;
  }
  safeCopyFile(src, dest);
  manifest[key] = template;
  return true;
}

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

  const manifestPath = path.join(projectRoot, MANIFEST);
  const manifest = readJSON<Record<string, string>>(manifestPath, {});
  const actions: string[] = [];
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
      if (!placeSkill(projectRoot, src, dest, manifest)) {
        skipped.push(`/${skill}`);
        continue;
      }
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
    if (!placeSkill(projectRoot, src, dest, manifest)) {
      actions.push(`Skill left untouched (customized): ${name} (delete .claude/skills/${name}/SKILL.md to get the updated template)`);
      continue;
    }
    installedSkills.push(name);
  }
  if (installedSkills.length > 0) {
    actions.push(`Claude skills installed: ${installedSkills.join(", ")} (.claude/skills/)`);
  }

  if (fs.existsSync(path.join(projectRoot, ".wolf"))) writeJSON(manifestPath, manifest);
  return actions;
}
