import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// cerebrum -> Claude Code auto-memory sync (Workstream J3).
//
// Claude Code keeps a persistent per-project memory directory at
// ~/.claude/projects/<slug>/memory/ with a MEMORY.md index that is loaded into
// context each session. Mirroring cerebrum's sections there lets Claude Code
// recall them natively, and the session-start digest stops re-injecting the
// Do-Not-Repeat block (killing the double injection). cerebrum.md stays the
// canonical store for every other agent (Codex, OpenCode, Gemini, Cursor).
//
// Feature detection: the sync only runs when the memory directory already
// exists — if auto-memory is disabled there is nobody to read what we write,
// and the digest suppression correctly stays off (it is gated on the marker
// this sync leaves in MEMORY.md).
//
// Dependency-free (node builtins only) so tests load it straight from source.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER_BEGIN = "<!-- openwolf:begin -->";
const MARKER_END = "<!-- openwolf:end -->";

const SECTION_FILES: Array<{ heading: RegExp; file: string; name: string; description: string }> = [
  {
    heading: /^## User Preferences/,
    file: "openwolf-preferences.md",
    name: "openwolf-preferences",
    description: "User preferences recorded by OpenWolf (synced from .wolf/cerebrum.md)",
  },
  {
    heading: /^## Key Learnings/,
    file: "openwolf-learnings.md",
    name: "openwolf-learnings",
    description: "Project learnings recorded by OpenWolf (synced from .wolf/cerebrum.md)",
  },
  {
    heading: /^## Do-Not-Repeat/,
    file: "openwolf-do-not-repeat.md",
    name: "openwolf-do-not-repeat",
    description: "Past mistakes to never repeat, recorded by OpenWolf (synced from .wolf/cerebrum.md)",
  },
];

/** Max entries mirrored per section (keeps each file well under budget). */
const MAX_ENTRIES = 40;
/** Hard byte cap per memory file (auto-memory budget is 25KB per file). */
const MAX_FILE_BYTES = 20 * 1024;

export function claudeMemoryDir(projectRoot: string, home: string = os.homedir()): string {
  const slug = path.resolve(projectRoot).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(home, ".claude", "projects", slug, "memory");
}

/** Extract one `## heading` section's entry lines (list items only). */
function sectionEntries(markdown: string, heading: RegExp): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    const t = lines[i].trim();
    if (t.startsWith("- ") || t.startsWith("* ") || /^\[[\d-]+\]/.test(t)) out.push(lines[i].trimEnd());
  }
  return out;
}

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export interface MemorySyncResult {
  synced: string[];
  skippedReason?: string;
}

/**
 * Mirror cerebrum sections into the Claude Code auto-memory directory.
 * Re-runnable: files are derived artifacts rewritten on content change only,
 * and the MEMORY.md index carries the sync in one marker block.
 */
export function syncCerebrumToClaudeMemory(
  projectRoot: string,
  wolfDir: string,
  home: string = os.homedir()
): MemorySyncResult {
  const memDir = claudeMemoryDir(projectRoot, home);
  if (!fs.existsSync(memDir)) {
    return { synced: [], skippedReason: "Claude auto-memory directory not found (feature off or project unused)" };
  }

  let cerebrum: string;
  try {
    cerebrum = fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8");
  } catch {
    return { synced: [], skippedReason: "no cerebrum.md" };
  }

  const synced: string[] = [];
  const indexLines: string[] = [];

  for (const section of SECTION_FILES) {
    const entries = sectionEntries(cerebrum, section.heading).slice(-MAX_ENTRIES);
    const destPath = path.join(memDir, section.file);
    if (entries.length === 0) {
      // Nothing to mirror; remove a previously synced file so stale advice
      // does not outlive its cerebrum source.
      try { fs.unlinkSync(destPath); } catch {}
      continue;
    }
    let body = entries.join("\n");
    while (Buffer.byteLength(body, "utf-8") > MAX_FILE_BYTES && entries.length > 1) {
      entries.shift();
      body = entries.join("\n");
    }
    const content = [
      "---",
      `name: ${section.name}`,
      `description: ${section.description}`,
      "metadata:",
      "  type: project",
      `  openwolf_sync: ${contentHash(body)}`,
      "---",
      "",
      "Synced from .wolf/cerebrum.md by openwolf update. Edit cerebrum.md, not this file; the next sync overwrites it.",
      "",
      body,
      "",
    ].join("\n");

    let existing = "";
    try { existing = fs.readFileSync(destPath, "utf-8"); } catch {}
    if (existing !== content) {
      fs.writeFileSync(destPath, content, "utf-8");
    }
    synced.push(section.file);
    indexLines.push(`- [${section.name}](${section.file}) : ${section.description}`);
  }

  // MEMORY.md: keep exactly one OpenWolf marker block, updated in place.
  const indexPath = path.join(memDir, "MEMORY.md");
  let index = "";
  try { index = fs.readFileSync(indexPath, "utf-8"); } catch {}
  const block = indexLines.length > 0
    ? `${MARKER_BEGIN}\n${indexLines.join("\n")}\n${MARKER_END}`
    : "";
  let next: string;
  if (index.includes(MARKER_BEGIN) && index.includes(MARKER_END)) {
    const pattern = new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`);
    next = block ? index.replace(pattern, block + "\n") : index.replace(pattern, "");
  } else if (block) {
    next = index.trim().length > 0
      ? index.replace(/\s*$/, "\n\n") + block + "\n"
      : `# Memory index\n\n${block}\n`;
  } else {
    next = index;
  }
  if (next !== index) {
    fs.writeFileSync(indexPath, next, "utf-8");
  }

  return { synced };
}

const CEREBRUM_BRIDGE_BEGIN = "<!-- openwolf:native-memory-index:begin -->";
const CEREBRUM_BRIDGE_END = "<!-- openwolf:native-memory-index:end -->";

/**
 * Reverse bridge (2.5): mirror the NATIVE auto-memory index (the MEMORY.md
 * lines outside OpenWolf's own marker block — i.e. what Claude Code learned
 * and recorded natively, machine-locally, Claude-only) into a marker-fenced
 * section of cerebrum.md. cerebrum is committed and read by every agent, so
 * learnings captured natively on one machine become at least discoverable to
 * Codex/Gemini/Cursor and to teammates. Index lines only, never file bodies:
 * pointers are cheap and honest; native topic files stay machine-local.
 */
export function syncClaudeMemoryIndexToCerebrum(
  projectRoot: string,
  wolfDir: string,
  home: string = os.homedir()
): boolean {
  let index: string;
  try {
    index = fs.readFileSync(path.join(claudeMemoryDir(projectRoot, home), "MEMORY.md"), "utf-8");
  } catch {
    return false;
  }
  // Everything outside our own marker block, list lines only.
  const withoutOurs = index.includes(MARKER_BEGIN)
    ? index.replace(new RegExp(`${MARKER_BEGIN}[\\s\\S]*?${MARKER_END}\\n?`), "")
    : index;
  const lines = withoutOurs
    .split("\n")
    .filter((l) => l.trim().startsWith("- "))
    .slice(0, 30);
  if (lines.length === 0) return false;

  const cerebrumPath = path.join(wolfDir, "cerebrum.md");
  let cerebrum: string;
  try {
    cerebrum = fs.readFileSync(cerebrumPath, "utf-8");
  } catch {
    return false;
  }

  const block = [
    CEREBRUM_BRIDGE_BEGIN,
    "## Native memory index (Claude Code, this machine)",
    "",
    "Topics Claude Code recorded in its own memory. The files live in the",
    "machine-local auto-memory directory, not in this repo; ask the person who",
    "owns this machine, or re-derive, if you need the detail.",
    "",
    ...lines,
    CEREBRUM_BRIDGE_END,
  ].join("\n");

  let next: string;
  if (cerebrum.includes(CEREBRUM_BRIDGE_BEGIN) && cerebrum.includes(CEREBRUM_BRIDGE_END)) {
    next = cerebrum.replace(
      new RegExp(`${CEREBRUM_BRIDGE_BEGIN}[\\s\\S]*?${CEREBRUM_BRIDGE_END}`),
      block
    );
  } else {
    next = cerebrum.replace(/\s*$/, "\n\n") + block + "\n";
  }
  if (next === cerebrum) return false;
  fs.writeFileSync(cerebrumPath, next, "utf-8");
  return true;
}

/** True when this project's MEMORY.md carries the OpenWolf sync marker. */
export function claudeMemoryHasSync(projectRoot: string, home: string = os.homedir()): boolean {
  try {
    const index = fs.readFileSync(path.join(claudeMemoryDir(projectRoot, home), "MEMORY.md"), "utf-8");
    return index.includes(MARKER_BEGIN);
  } catch {
    return false;
  }
}
