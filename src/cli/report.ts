import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { scanProjectUsage, projectTranscriptDir } from "../tracker/transcript-usage.js";
import { readUsageSequence, attributeCacheRebuilds, type CacheRebuild } from "../tracker/cache-attribution.js";
import * as fsMod from "node:fs";

// `openwolf report` — Workstream F1: the verifiable-numbers view.
// Estimated figures come from OpenWolf's char-ratio heuristics; real figures
// come from the harness transcripts (message usage summed by the stop hook).

interface RealUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

interface Ledger {
  lifetime: Record<string, number>;
  sessions: Array<{
    id: string;
    ended: string;
    totals: { input_tokens_estimated: number; output_tokens_estimated: number; reads_count: number; writes_count: number };
    real_usage?: RealUsage;
  }>;
}

const fmt = (n: number | undefined): string => (n ?? 0).toLocaleString("en-US");

export function reportCommand(): void {
  const projectRoot = findProjectRoot();
  const ledger = readJSON<Ledger>(path.join(projectRoot, ".wolf", "token-ledger.json"), {
    lifetime: {}, sessions: [],
  });
  const lt = ledger.lifetime;

  console.log("");
  console.log("  OpenWolf token report");
  console.log("  ─────────────────────");
  // Measured numbers lead: they come from the harness's own per-message
  // usage records and are the only figures worth trusting. Estimates follow,
  // clearly labeled as heuristics.
  //
  // Ground truth first (J1): a live scan of every transcript in the harness's
  // project directory, including subagent sidechains and headless runs the
  // Stop hook never saw.
  let scannedLive = false;
  try {
    const measured = scanProjectUsage(projectRoot);
    if (measured) {
      scannedLive = true;
      console.log("  Measured (all project transcripts, scanned now)");
      console.log(`    API calls:              ${fmt(measured.api_calls)}`);
      console.log(`    Input tokens:           ${fmt(measured.input_tokens)}`);
      console.log(`    Output tokens:          ${fmt(measured.output_tokens)}`);
      console.log(`    Cache reads:            ${fmt(measured.cache_read_input_tokens)}`);
      console.log(`    Cache writes:           ${fmt(measured.cache_creation_input_tokens)}`);
      if (measured.sidechain.api_calls > 0) {
        console.log(`    Subagent share:         in ${fmt(measured.sidechain.input_tokens)} | out ${fmt(measured.sidechain.output_tokens)} (${fmt(measured.sidechain.api_calls)} calls)`);
      }
      const models = Object.entries(measured.by_model);
      if (models.length > 1) {
        for (const [model, m] of models.sort((a, b) => b[1].output_tokens - a[1].output_tokens)) {
          console.log(`    ${model}: in ${fmt(m.input_tokens)} | out ${fmt(m.output_tokens)} | cache-read ${fmt(m.cache_read_input_tokens)}`);
        }
      }
    }
  } catch {}
  if (!scannedLive && lt.real_api_calls) {
    console.log("  Measured (from harness transcripts at session end)");
    console.log(`    API calls:              ${fmt(lt.real_api_calls)}`);
    console.log(`    Input tokens:           ${fmt(lt.real_input_tokens)}`);
    console.log(`    Output tokens:          ${fmt(lt.real_output_tokens)}`);
    console.log(`    Cache reads:            ${fmt(lt.real_cache_read_tokens)}`);
    console.log(`    Cache writes:           ${fmt(lt.real_cache_creation_tokens)}`);
  } else if (!scannedLive) {
    console.log("  Measured usage: none found yet — transcripts are scanned from");
    console.log("  the harness project directory and at session end by the Stop hook.");
  }
  console.log("");
  console.log(`  Sessions:                 ${fmt(lt.total_sessions)}`);
  console.log(`  Reads / writes:           ${fmt(lt.total_reads)} / ${fmt(lt.total_writes)}`);
  console.log(`  Anatomy hits / misses:    ${fmt(lt.anatomy_hits)} / ${fmt(lt.anatomy_misses)}`);
  console.log(`  Duplicate reads warned:   ${fmt(lt.repeated_reads_warned)}`);
  console.log(`  Duplicate reads denied:   ${fmt(lt.repeated_reads_blocked)}`);
  console.log("");
  console.log("  Estimated (char-ratio heuristic; treat as rough)");
  console.log(`    Total tokens tracked:   ${fmt(lt.total_tokens_estimated)}`);
  console.log(`    Saved by denied reads:  ${fmt(lt.estimated_savings_vs_bare_cli)}`);
  console.log(`    OpenWolf injected:      ${fmt(lt.injection_tokens_estimated)} (digests, hints, warnings)`);
  if ((lt.bash_governed_calls ?? 0) > 0) {
    const kept = (lt.bash_governed_original_tokens ?? 0) - (lt.bash_governed_entered_tokens ?? 0);
    console.log("");
    console.log("  Bash governor (measured at the rewrite point)");
    console.log(`    Governed calls:         ${fmt(lt.bash_governed_calls)}`);
    console.log(`    Original output:        ${fmt(lt.bash_governed_original_tokens)}`);
    console.log(`    Entered context:        ${fmt(lt.bash_governed_entered_tokens)}`);
    console.log(`    Kept out of context:    ${fmt(kept)}`);
  }

  // Cache-invalidation attribution (2.2): the largest waste class, named.
  try {
    const dir = projectTranscriptDir(projectRoot);
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const rebuilds: CacheRebuild[] = [];
    for (const f of fsMod.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path.join(dir, f);
      try { if (fsMod.statSync(p).mtimeMs < cutoff) continue; } catch { continue; }
      const seq = readUsageSequence(p);
      if (!seq) continue;
      rebuilds.push(...attributeCacheRebuilds(seq.calls, seq.compactions).rebuilds);
    }
    if (rebuilds.length > 0) {
      const totalTok = rebuilds.reduce((s, r) => s + r.creation_tokens, 0);
      console.log("");
      console.log(`  Cache rebuilds (last 7 days): ${rebuilds.length} events, ${fmt(totalTok)} tokens re-written`);
      const byCause = new Map<string, { n: number; tok: number }>();
      for (const r of rebuilds) {
        const b = byCause.get(r.cause) ?? { n: 0, tok: 0 };
        b.n++; b.tok += r.creation_tokens;
        byCause.set(r.cause, b);
      }
      for (const [cause, b] of [...byCause.entries()].sort((a, z) => z[1].tok - a[1].tok)) {
        console.log(`    ${cause.padEnd(16)} ${String(b.n).padStart(3)} events  ${fmt(b.tok)} tok`);
      }
      console.log("    (each rebuild re-pays the prefix at the cache-write rate instead of 0.1x reads)");
    }
  } catch {}

  const withReal = ledger.sessions.filter((s) => s.real_usage);
  if (withReal.length > 0) {
    console.log("");
    console.log("  Last sessions (measured)");
    for (const s of withReal.slice(-5)) {
      const r = s.real_usage!;
      console.log(`    ${s.ended?.slice(0, 16) ?? "?"}  in ${fmt(r.input_tokens)} | out ${fmt(r.output_tokens)} | cache-read ${fmt(r.cache_read_input_tokens)} (${r.api_calls} calls)`);
    }
  }
  console.log("");
}
