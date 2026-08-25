import * as fs from "node:fs";
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, writeJSON, appendMarkdown, readJSON, readBugLogFile, timestamp, timeShort, estimateTokens, readStdin, detectAgent, recordInjectionToSessionFile, getProjectDir, hookMain, getSessionFilePath, gcSessionFiles, readSessionState } from "./shared.js";
import { loadStore } from "./anatomy-store.js";
import { topRules, scopedRulesForFiles } from "./rule-reinjection.js";

// ─── Session digest (Workstream E/F: model-aware context budgeting) ─────────
//
// Instead of relying on the agent to read .wolf/ files, inject a compact
// digest of the highest-value state directly into the session's context via
// the SessionStart additionalContext channel — capped to a per-agent token
// budget so injection cost stays fixed and predictable.

interface ContextConfig {
  session_digest_budget_tokens?: number;
  budgets?: Record<string, number>;
}

function digestBudget(wolfDir: string): number {
  const cfg = readJSON<{ openwolf?: { context?: ContextConfig } }>(
    path.join(wolfDir, "config.json"), {}
  );
  const ctx = cfg.openwolf?.context ?? {};
  const agent = detectAgent();
  return ctx.budgets?.[agent] ?? ctx.session_digest_budget_tokens ?? 1500;
}

/** Extract one `## heading` section (heading line through the next ## or ---). */
function extractSection(markdown: string, headingPattern: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => headingPattern.test(l));
  if (start === -1) return "";
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]) || /^---\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/**
 * True when this project's cerebrum was synced into Claude Code auto-memory
 * (openwolf update leaves a marker in the memory index). Claude then recalls
 * Do-Not-Repeat natively, so the digest must not inject it a second time.
 */
function claudeMemoryHasSync(): boolean {
  if (detectAgent() !== "claude") return false;
  try {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (!home) return false;
    const slug = path.resolve(getProjectDir()).replace(/[^a-zA-Z0-9]/g, "-");
    const index = fs.readFileSync(path.join(home, ".claude", "projects", slug, "memory", "MEMORY.md"), "utf-8");
    return index.includes("<!-- openwolf:begin -->");
  } catch {
    return false;
  }
}

/** Parse a leading YAML-ish frontmatter block for description/always keys (2.4). */
function readFrontmatter(content: string): { description?: string; always?: boolean; body: string } {
  if (!content.startsWith("---\n")) return { body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { body: content };
  const fm = content.slice(4, end);
  const body = content.slice(content.indexOf("\n", end + 1) + 1);
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const always = /^always:\s*true\s*$/m.test(fm);
  return { description, always, body };
}

/**
 * Progressive-disclosure digest (2.4). The old digest injected content
 * (mean 794 tok, 75% of it a staleness nag or placeholder text). The new
 * shape is an INDEX: one line per live .wolf file with what it is, how big,
 * and how fresh, so the model can decide what to pull with grep or find —
 * the retrieval pattern claude-mem, Letta, and the platform's own skills
 * design converged on. Only two things still inject content: the top
 * Do-Not-Repeat rules (small, highest value, unless native auto-memory
 * already carries them) and any .wolf file whose frontmatter says
 * `always: true` (budget-capped). Target: ~400 tokens.
 */
function buildSessionDigest(wolfDir: string, budget: number): string {
  budget = Math.min(budget, 400 + Math.floor(budget / 4));
  const parts: string[] = [];
  let used = 0;
  const tryAdd = (text: string): boolean => {
    if (!text) return false;
    const cost = estimateTokens(text, "prose");
    if (used + cost > budget) return false;
    parts.push(text);
    used += cost;
    return true;
  };
  const isPlaceholder = (l: string) => /_<[^>]*>_|\{\{[^}]*\}\}|^_?<[^>]*>_?$/.test(l.trim());

  // 1. STATUS.md "next phase": the one piece of content that always earns its
  // tokens on resume — but never template placeholders (8/28 measured digests
  // were pure placeholder before this filter).
  try {
    const status = fs.readFileSync(path.join(wolfDir, "STATUS.md"), "utf-8");
    const section = extractSection(readFrontmatter(status).body, /^## 🚀/);
    const meaningful = section.split("\n").filter((l) => l.trim() && !isPlaceholder(l));
    const contentLines = meaningful.filter((l) => !/^#|^\||^-+$/.test(l.trim()));
    if (contentLines.length > 0) tryAdd(meaningful.slice(0, 14).join("\n"));
  } catch {}

  // 2. Top Do-Not-Repeat rules (skipped when native auto-memory carries them).
  if (!claudeMemoryHasSync()) {
    try {
      const cerebrum = readFrontmatter(fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8")).body;
      const dnr = extractSection(cerebrum, /^## Do-Not-Repeat/);
      const entries = dnr.split("\n").filter((l) => l.startsWith("- ") && !isPlaceholder(l));
      if (entries.length > 0) {
        tryAdd("Do-Not-Repeat (top rules from .wolf/cerebrum.md):\n" + entries.slice(-3).join("\n"));
      }
    } catch {}
  }

  // 3. always:true files — the Letta-style explicit always-loaded set, capped.
  try {
    for (const f of fs.readdirSync(wolfDir)) {
      if (!f.endsWith(".md") || f === "STATUS.md" || f === "OPENWOLF.md" || f === "anatomy.md") continue;
      const raw = fs.readFileSync(path.join(wolfDir, f), "utf-8");
      const fm = readFrontmatter(raw);
      if (fm.always) {
        tryAdd(`## .wolf/${f} (always)\n` + fm.body.trim().split("\n").slice(0, 40).join("\n"));
      }
    }
  } catch {}

  // 4. The index: one line per live state file. Pointers, not content.
  try {
    const indexLines: string[] = [];
    const describe: Record<string, string> = {
      "cerebrum.md": "learned preferences, conventions, Do-Not-Repeat rules",
      "memory.md": "chronological action log per session",
      "STATUS.md": "session handoff (regenerate with /handoff)",
      "buglog.json": "known bugs with root causes and fixes (openwolf bug search)",
      "anatomy.md": "project file index (query with openwolf find, never read whole)",
    };
    for (const [file, fallback] of Object.entries(describe)) {
      const p = path.join(wolfDir, file);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      let desc = fallback;
      let extra = "";
      if (file === "buglog.json") {
        const bugs = readBugLogFile(wolfDir).bugs.length;
        if (bugs === 0) continue;
        extra = `, ${bugs} bugs`;
      } else if (file.endsWith(".md")) {
        const fm = readFrontmatter(fs.readFileSync(p, "utf-8"));
        if (fm.description) desc = fm.description;
        // A template-only file earns no index line.
        if (fm.body.trim().length < 80) continue;
      }
      const tok = Math.ceil(st.size / 4);
      indexLines.push(`- .wolf/${file}: ${desc} (~${tok} tok${extra}, updated ${st.mtime.toISOString().slice(0, 10)})`);
    }
    if (indexLines.length > 0) {
      tryAdd("OpenWolf state on disk (read on demand, not preloaded):\n" + indexLines.join("\n"));
    }
  } catch {}

  return parts.join("\n\n");
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  // Clean up stale .tmp files left from failed atomic writes
  try {
    const files = fs.readdirSync(wolfDir);
    for (const f of files) {
      if (f.endsWith(".tmp")) {
        try { fs.unlinkSync(path.join(wolfDir, f)); } catch {}
      }
    }
  } catch {}
  const hooksDir = path.join(wolfDir, "hooks");
  const now = new Date();

  // SessionStart fires for startup/resume/clear/compact. Only startup and
  // clear begin a genuinely new session — on resume/compact the session is
  // still live, and resetting the session state would wipe read/write
  // tracking mid-flight (Workstream F3: compaction survival).
  let source = "startup";
  let hookInput: { source?: string; session_id?: string } = {};
  try {
    hookInput = JSON.parse(await readStdin());
    if (typeof hookInput.source === "string") source = hookInput.source;
  } catch {}
  // Session state is keyed by the harness session id (2.2): concurrent
  // sessions in one project no longer cross-contaminate each other.
  const sessionFile = getSessionFilePath(hookInput);
  const sessionId = hookInput.session_id ??
    `session-${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  gcSessionFiles();

  // Hook install self-test (2.2): a missing dependency file once silently
  // killed a hook for 3 weeks across 440 invocations. Verify every installed
  // hook's relative imports resolve; surface breakage in the digest.
  const brokenHooks = selfTestHooks(hooksDir);

  const continuing = (source === "compact" || source === "resume") && fs.existsSync(sessionFile);

  // Compaction evicts verbatim file contents from the model's context, so a
  // post-compact re-read is legitimate: clear deny-eligibility on every
  // recorded read (the warn path still fires; only denial is disarmed).
  if (continuing && source === "compact") {
    try {
      const session = readSessionState(sessionFile, hookInput.session_id) as { files_read?: Record<string, { compacted?: boolean }> };
      if (session.files_read) {
        for (const entry of Object.values(session.files_read)) {
          entry.compacted = true;
        }
        writeJSON(sessionFile, session);
      }
    } catch {}
  }

  if (!continuing) {
    writeJSON(sessionFile, {
      session_id: sessionId,
      started: timestamp(),
      files_read: {},
      files_written: [],
      edit_counts: {},
      anatomy_hits: 0,
      anatomy_misses: 0,
      repeated_reads_warned: 0,
      stop_count: 0,
    });

    // Append session header to memory.md
    const memoryPath = path.join(wolfDir, "memory.md");
    const header = `\n## Session: ${now.toISOString().slice(0, 10)} ${timeShort()}\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`;
    appendMarkdown(memoryPath, header);
  }

  // Startup nudges — folded into the injected digest below (stderr from an
  // exit-0 hook never reaches the model).
  const startupNotes: string[] = [];
  try {
    const cerebrumPath = path.join(wolfDir, "cerebrum.md");
    const cerebrumContent = fs.readFileSync(cerebrumPath, "utf-8");
    const stat = fs.statSync(cerebrumPath);
    const daysSinceUpdate = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);

    // Count actual entries (non-comment, non-empty lines in content sections)
    const entryLines = cerebrumContent.split("\n").filter(l => {
      const t = l.trim();
      return t.startsWith("- ") || t.startsWith("* ") || (t.startsWith("[") && t.includes("]"));
    });

    if (entryLines.length < 3) {
      startupNotes.push(
        `cerebrum.md has only ${entryLines.length} entries. Record user preferences, project conventions, and mistakes to .wolf/cerebrum.md as you learn them this session.`
      );
    } else if (daysSinceUpdate > 3) {
      startupNotes.push(
        `cerebrum.md hasn't been updated in ${Math.floor(daysSinceUpdate)} days. Look for opportunities to add learnings this session.`
      );
    }
  } catch {}

  try {
    if (readBugLogFile(wolfDir).bugs.length === 0) {
      startupNotes.push(
        `buglog.json is empty. If you encounter or fix any bugs, errors, or failed tests this session, log them to .wolf/buglog.json.`
      );
    }
  } catch {}

  // Increment total_sessions in token-ledger — only for a genuinely new
  // session. Resume/compact re-fires SessionStart for a session already
  // counted, which used to inflate the lifetime count.
  if (!continuing) {
    const ledgerPath = path.join(wolfDir, "token-ledger.json");
    const ledger = readJSON(ledgerPath, { version: 1, lifetime: { total_sessions: 0 } }) as {
      version: number;
      lifetime: { total_sessions: number };
      [key: string]: unknown;
    };
    ledger.lifetime.total_sessions++;
    writeJSON(ledgerPath, ledger);
  }

  // Inject the budget-capped digest into the model's context.
  try {
    let digest = buildSessionDigest(wolfDir, digestBudget(wolfDir));

    // (The anatomy-staleness banner is gone in 2.2: it led 21 of 28 measured
    // digests because a 6h rescan interval loses to normal commit cadence —
    // a warning firing 75% of the time is a tax, not a signal. Freshness is
    // the daemon's and scan's job, not the model's.)

    // Hook breakage is the one warning worth its tokens: without it, a broken
    // install silently loses every feature (happened for 3 weeks once).
    if (brokenHooks.length > 0) {
      digest = `OpenWolf hooks are degraded: ${brokenHooks.join("; ")}. Run \`openwolf update\` in this project to repair the install.\n\n` + digest;
    }

    // Post-compaction restore (F3 + 2.4): resurface what compaction erased.
    // The platform documents that paths-scoped rules and nested CLAUDE.md are
    // LOST at compaction until a matching file is read again — restore the
    // scoped rules for files this session already touched, plus the top
    // Do-Not-Repeat rules (decay countermeasure) and the in-flight state.
    if (continuing && source === "compact") {
      const session = readSessionState(sessionFile, hookInput.session_id) as { files_written?: Array<{ file: string }>; files_read?: Record<string, unknown>; edit_counts?: Record<string, number> };
      const restoreParts: string[] = [];

      const files = [...new Set((session.files_written ?? []).map((w) => w.file))];
      if (files.length > 0) {
        restoreParts.push(`## Session in progress (context was just compacted)\nFiles already modified this session: ${files.slice(-15).join(", ")}. Do not re-read them wholesale — check .wolf/memory.md for what was done.`);
      }

      try {
        const rules = topRules(fs.readFileSync(path.join(wolfDir, "cerebrum.md"), "utf-8"), 3);
        if (rules.length > 0) {
          restoreParts.push(`Project rules still in effect (from .wolf/cerebrum.md Do-Not-Repeat):\n${rules.join("\n")}`);
        }
      } catch {}

      try {
        const projectDir = getProjectDir();
        const relFiles = [
          ...Object.keys(session.files_read ?? {}),
          ...files,
        ].map((f) => path.isAbsolute(f) ? path.relative(projectDir, f).split(path.sep).join("/") : f);
        restoreParts.push(...scopedRulesForFiles(projectDir, relFiles));
      } catch {}

      if (restoreParts.length > 0) {
        digest = restoreParts.join("\n\n") + (digest ? "\n\n" + digest : "");
      }
    }

    if (startupNotes.length > 0) {
      digest = digest
        ? `${digest}\n\n${startupNotes.map((n) => `- ${n}`).join("\n")}`
        : startupNotes.map((n) => `- ${n}`).join("\n");
    }

    if (digest) {
      recordInjectionToSessionFile(sessionFile, "digest", digest);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: digest },
      }));
    }
  } catch {}
}

/**
 * Verify every installed hook script's relative imports resolve (2.2). The
 * 440-crash class was a missing DEPENDENCY file, not a missing hook, so a
 * bare existence check of registered hooks would have missed it. Cheap static
 * check: scan each installed hook script for relative import specifiers and
 * verify the target files exist. Returns problem strings (empty = healthy).
 */
function selfTestHooks(hooksDir: string): string[] {
  const problems: string[] = [];
  try {
    const files = fs.readdirSync(hooksDir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      let src = "";
      try {
        src = fs.readFileSync(path.join(hooksDir, f), "utf-8");
      } catch {
        problems.push(`${f} unreadable`);
        continue;
      }
      for (const m of src.matchAll(/from\s+["']\.\/([\w.-]+\.js)["']/g)) {
        if (!fs.existsSync(path.join(hooksDir, m[1]))) {
          problems.push(`${f} cannot load ${m[1]}`);
        }
      }
    }
  } catch {}
  return [...new Set(problems)].slice(0, 3);
}

hookMain("session-start", main);
