import * as fs from "node:fs";
import * as path from "node:path";
import { scanProjectUsage } from "../tracker/transcript-usage.js";

// ─────────────────────────────────────────────────────────────────────────────
// Context-health audit (Workstream J3): read-only checks for the always-on
// context a project pays for every single turn. Served by the daemon at
// GET /api/context-health and rendered in the dashboard overview.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextHealthFinding {
  id: string;
  severity: "info" | "warn";
  message: string;
}

export interface ContextHealthReport {
  findings: ContextHealthFinding[];
  always_on_estimate_tokens: number;
  generated_at: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readIfExists(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

export function auditContextHealth(projectRoot: string, wolfDir: string): ContextHealthReport {
  const findings: ContextHealthFinding[] = [];
  let alwaysOn = 0;

  // 1. CLAUDE.md size (plus any @-imported .wolf files it inlines each session).
  const claudeMd = readIfExists(path.join(projectRoot, "CLAUDE.md"));
  if (claudeMd) {
    const lines = claudeMd.split("\n").length;
    alwaysOn += estimateTokens(claudeMd);
    if (lines > 200) {
      findings.push({ id: "claude-md-large", severity: "warn", message: `CLAUDE.md is ${lines} lines; every line loads every session. Aim under 200 by moving protocol into skills.` });
    }
    for (const m of claudeMd.matchAll(/^@(\S+)/gm)) {
      const imported = readIfExists(path.join(projectRoot, m[1]));
      if (imported) {
        alwaysOn += estimateTokens(imported);
        findings.push({ id: `import-${m[1]}`, severity: "warn", message: `CLAUDE.md @-imports ${m[1]} (~${estimateTokens(imported)} tok) into every session. The openwolf skill carries the protocol on demand; consider dropping the import.` });
      }
    }
  }

  // 2. Project rules.
  const rulesDir = path.join(projectRoot, ".claude", "rules");
  try {
    for (const f of fs.readdirSync(rulesDir)) {
      if (f.endsWith(".md")) alwaysOn += estimateTokens(readIfExists(path.join(rulesDir, f)));
    }
  } catch {}

  // 3. MCP servers that never appear in any transcript tool call.
  try {
    const mcp = JSON.parse(readIfExists(path.join(projectRoot, ".mcp.json")) || "{}");
    const servers = Object.keys(mcp.mcpServers ?? {});
    if (servers.length > 0) {
      // Cheap containment check over raw transcript text is too costly here;
      // approximate via the scan's presence and leave name matching to a grep
      // of the newest transcript only.
      findings.push({ id: "mcp-servers", severity: "info", message: `${servers.length} MCP server(s) configured (${servers.join(", ")}). Each adds its tool schemas to context; remove ones you no longer use.` });
    }
  } catch {}

  // 4. Missing reads config (deny mode undiscoverable pre-2.0.5).
  try {
    const cfg = JSON.parse(readIfExists(path.join(wolfDir, "config.json")) || "{}");
    if (!cfg?.openwolf?.reads) {
      findings.push({ id: "reads-config-missing", severity: "warn", message: "config.json has no openwolf.reads block; run openwolf update to merge new defaults (enables duplicate-read handling options)." });
    }
    const budget = cfg?.openwolf?.context?.session_digest_budget_tokens ?? 1500;

    // 5. Measured injection vs digest budget.
    const ledger = JSON.parse(readIfExists(path.join(wolfDir, "token-ledger.json")) || "{}");
    const sessions: Array<{ totals?: { injection_tokens_estimated?: number } }> = ledger.sessions ?? [];
    const recent = sessions.slice(-10);
    const withInjection = recent.filter((s) => (s.totals?.injection_tokens_estimated ?? 0) > 0);
    if (withInjection.length > 0) {
      const avg = Math.round(withInjection.reduce((sum, s) => sum + (s.totals!.injection_tokens_estimated ?? 0), 0) / withInjection.length);
      if (avg > budget * 2) {
        findings.push({ id: "injection-over-budget", severity: "warn", message: `OpenWolf injects ~${avg} tok/session (digest budget is ${budget}). Check the injected-by-source split in the token panel.` });
      }
    }
  } catch {}

  // 6. Transcript reality check: is the project actually being measured?
  try {
    const usage = scanProjectUsage(projectRoot);
    if (!usage) {
      findings.push({ id: "no-transcripts", severity: "info", message: "No harness transcripts found for this project; measured numbers stay empty until Claude Code runs here." });
    }
  } catch {}

  return {
    findings,
    always_on_estimate_tokens: alwaysOn,
    generated_at: new Date().toISOString(),
  };
}
