import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";

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
  console.log(`  Sessions:                 ${fmt(lt.total_sessions)}`);
  console.log(`  Reads / writes:           ${fmt(lt.total_reads)} / ${fmt(lt.total_writes)}`);
  console.log(`  Anatomy hits / misses:    ${fmt(lt.anatomy_hits)} / ${fmt(lt.anatomy_misses)}`);
  console.log(`  Repeated reads blocked:   ${fmt(lt.repeated_reads_blocked)}`);
  console.log("");
  console.log("  Estimated (char-ratio heuristic)");
  console.log(`    Total tokens:           ${fmt(lt.total_tokens_estimated)}`);
  console.log(`    Est. savings vs bare:   ${fmt(lt.estimated_savings_vs_bare_cli)}`);
  console.log("");
  if (lt.real_api_calls) {
    console.log("  Measured (from harness transcripts)");
    console.log(`    API calls:              ${fmt(lt.real_api_calls)}`);
    console.log(`    Input tokens:           ${fmt(lt.real_input_tokens)}`);
    console.log(`    Output tokens:          ${fmt(lt.real_output_tokens)}`);
    console.log(`    Cache reads:            ${fmt(lt.real_cache_read_tokens)}`);
    console.log(`    Cache writes:           ${fmt(lt.real_cache_creation_tokens)}`);
  } else {
    console.log("  Measured usage: none recorded yet — it accumulates as sessions");
    console.log("  end (the Stop hook reads real usage from the transcript).");
  }

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
