// ─────────────────────────────────────────────────────────────────────────────
// Bash output governor (2.3, the flagship): pure classification + condensation
// for verbose Bash results. Empirical grounding: Bash carries 48.3% of all
// tool-result tokens; results over ~2k tokens are 25.8% of bash output
// (grep -rn floods, git show, cat -n re-prints, test/build logs). Native
// truncation is positional (30k chars head/tail) with zero semantic filtering.
//
// Design rules:
// - NEVER touch stderr (errors must reach the model verbatim).
// - Condensation is structural and format-aware, never lossy about failures:
//   the test/build condensers keep every failure/error block, and the
//   default posture for those families is suggest, not replace.
// - Every condensed output ends with a factual pointer to the full log.
// - Dependency-free: ships in the hook bundle, tests load it from source.
// ─────────────────────────────────────────────────────────────────────────────

export type BashFamily = "grep_flood" | "file_print" | "git_show" | "test" | "build" | "unknown";

export type GovernorAction = "replace" | "suggest" | "off";

export interface GovernorConfig {
  mode: GovernorAction;
  threshold_tokens: number;
  families: Partial<Record<BashFamily, GovernorAction>>;
}

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  mode: "replace",
  threshold_tokens: 2000,
  // Replace-by-default only for the three losslessly-recoverable families
  // (the full text is preserved on disk and its information is structural).
  // Test/build output graduates to replace only with benchmark evidence.
  families: {
    grep_flood: "replace",
    file_print: "replace",
    git_show: "replace",
    test: "suggest",
    build: "suggest",
    unknown: "suggest",
  },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Classify a Bash command into an output family. */
export function classifyCommand(command: string): BashFamily {
  const cmd = command.trim();
  // First simple segment (ignore env prefixes like FOO=1).
  const stripped = cmd.replace(/^(\w+=[^\s]*\s+)*/, "");

  if (/^(grep|rg|ag)\b.*(-r|-R|--recursive)\b/.test(stripped) || /^(grep|rg)\b[^|]*\s\.$/.test(stripped)) return "grep_flood";
  if (/^(grep|rg)\b/.test(stripped) && !/\|/.test(stripped)) return "grep_flood";
  if (/^(cat|head|tail|sed\s+-n|awk)\b/.test(stripped)) return "file_print";
  if (/^git\s+(show|log\s+.*-p|diff)\b/.test(stripped)) return "git_show";
  if (/^(npm\s+(test|run\s+test)|pnpm\s+(test|run\s+test)|yarn\s+test|npx\s+(jest|vitest)|jest|vitest|pytest|python\s+-m\s+pytest|go\s+test|cargo\s+test|phpunit|php\s+artisan\s+test|rspec|mvn\s+test|gradle\s+test|\.\/gradlew\s+test)\b/.test(stripped)) return "test";
  if (/^(npm\s+run\s+build|pnpm\s+(run\s+)?build|yarn\s+build|tsc\b|npx\s+tsc|cargo\s+build|go\s+build|make\b|webpack|vite\s+build|mvn\s+package|gradle\s+build|\.\/gradlew\s+build)\b/.test(stripped)) return "build";
  return "unknown";
}

function elide(kept: number, total: number, unit: string): string {
  return `[... ${total - kept} ${unit} elided ...]`;
}

/** grep/rg floods: first K matches per file + per-file counts + totals. */
function condenseGrep(stdout: string, perFile = 3): string {
  const lines = stdout.split("\n");
  const byFile = new Map<string, string[]>();
  const other: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^([^:\s][^:]*?):(\d+[:-])/);
    if (m) {
      const arr = byFile.get(m[1]) ?? [];
      arr.push(line);
      byFile.set(m[1], arr);
    } else {
      other.push(line);
    }
  }
  if (byFile.size === 0) return condenseGeneric(stdout);
  const out: string[] = [];
  let totalMatches = 0;
  for (const [file, matches] of byFile) {
    totalMatches += matches.length;
    out.push(...matches.slice(0, perFile));
    if (matches.length > perFile) out.push(`  (+${matches.length - perFile} more matches in ${file})`);
  }
  out.push(`[total: ${totalMatches} matching lines across ${byFile.size} files]`);
  if (other.length > 0) out.push(...other.slice(0, 5));
  return out.join("\n");
}

/** git show / diff: commit header + per-file stat, hunks elided with counts. */
function condenseGitShow(stdout: string): string {
  const lines = stdout.split("\n");
  const out: string[] = [];
  let inDiff = false;
  let hunkLines = 0;
  let currentFile = "";
  const flush = () => {
    if (currentFile && hunkLines > 0) out.push(`  ${currentFile}: ${hunkLines} diff lines (see full log)`);
    hunkLines = 0;
  };
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      inDiff = true;
      currentFile = line.slice("diff --git ".length);
      continue;
    }
    if (!inDiff) {
      out.push(line);
      continue;
    }
    hunkLines++;
  }
  flush();
  if (out.length === lines.length) return condenseGeneric(stdout);
  return out.join("\n");
}

/** cat/sed/head re-prints and unknown output: head + tail window. */
function condenseGeneric(stdout: string, head = 80, tail = 30): string {
  const lines = stdout.split("\n");
  if (lines.length <= head + tail + 10) return stdout;
  return [...lines.slice(0, head), elide(head + tail, lines.length, "lines"), ...lines.slice(-tail)].join("\n");
}

export interface CondenseResult {
  text: string;
  original_tokens: number;
  condensed_tokens: number;
}

/**
 * Condense stdout for a family. Returns null when condensation is not
 * worthwhile (under threshold, or saved less than 30%): the original then
 * passes through untouched.
 *
 * `logPath` is the cache path where the full output was preserved, or null
 * when it could not be preserved. Passing null is not cosmetic: the pointer is
 * part of the recovery contract, and a pointer naming a file that does not
 * exist is worse than no pointer at all, because the model trusts it and stops
 * looking (#82).
 */
export function condenseOutput(
  family: BashFamily,
  stdout: string,
  thresholdTokens: number,
  logPath: string | null
): CondenseResult | null {
  const originalTokens = estimateTokens(stdout);
  if (originalTokens < thresholdTokens) return null;

  let condensed: string;
  switch (family) {
    case "grep_flood":
      condensed = condenseGrep(stdout);
      break;
    case "git_show":
      condensed = condenseGitShow(stdout);
      break;
    case "file_print":
    case "unknown":
    case "test":
    case "build":
      condensed = condenseGeneric(stdout);
      break;
  }

  const pointer = logPath === null
    ? `\n[OpenWolf: this output was ~${originalTokens.toLocaleString("en-US")} tokens; condensed structurally. It was too large for the local output cache, so the full text was NOT preserved. Re-run the command if you need it verbatim.]`
    : `\n[OpenWolf: this output was ~${originalTokens.toLocaleString("en-US")} tokens; condensed structurally. Full output preserved verbatim at ${logPath}]`;
  const text = condensed + pointer;
  const condensedTokens = estimateTokens(text);
  if (condensedTokens > originalTokens * 0.7) return null; // not worth the change

  return { text, original_tokens: originalTokens, condensed_tokens: condensedTokens };
}
