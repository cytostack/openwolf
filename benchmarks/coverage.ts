import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

interface SeamModule {
  name: string;
  file: string;
  functions: string[];
}
interface SeamDomain {
  name: string;
  modules: SeamModule[];
}
interface SeamsFile {
  version: number;
  domains: SeamDomain[];
}

export interface CoverageResult {
  seams_total: number;
  seams_tested: number;
  seams_untested: number;
  coverage_pct: number;
  gaps: string[];
  automated: { line_coverage_pct: number | null };
}

const SEAMS_PATH = path.join(import.meta.dirname, "seams.json");
const ROOT = path.join(import.meta.dirname, "..");
const TESTS_DIR = path.join(ROOT, "tests");

function loadSeams(): SeamsFile {
  return JSON.parse(fs.readFileSync(SEAMS_PATH, "utf-8")) as SeamsFile;
}

function testSources(): string[] {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => fs.readFileSync(path.join(TESTS_DIR, f), "utf-8"));
}

/** Best-effort line coverage via the built-in test runner. Returns null on failure. */
function automatedLineCoverage(): number | null {
  const result = spawnSync(
    process.execPath,
    ["--test", "--experimental-test-coverage", "tests/*.test.ts"],
    { cwd: ROOT, encoding: "utf-8", timeout: 120_000 }
  );
  if (result.status !== 0) return null;
  // "All files | %Stmts | %Branch | %Funcs | %Lines | ..."
  const m = result.stdout.match(
    /All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/
  );
  return m ? Number(m[1]) : null;
}

export function collectCoverage(options?: {
  automatedCoverage?: boolean;
}): CoverageResult {
  const seams = loadSeams();
  const sources = testSources();
  const gaps: string[] = [];
  let total = 0;
  let tested = 0;

  for (const domain of seams.domains) {
    for (const mod of domain.modules) {
      for (const fn of mod.functions) {
        total++;
        const pattern = new RegExp(`\\b${fn}\\b`);
        if (sources.some((src) => pattern.test(src))) {
          tested++;
        } else {
          gaps.push(`${domain.name}.${mod.name}.${fn}`);
        }
      }
    }
  }

  return {
    seams_total: total,
    seams_tested: tested,
    seams_untested: total - tested,
    coverage_pct: total > 0 ? Math.round((tested / total) * 1000) / 10 : 0,
    gaps,
    automated: {
      line_coverage_pct: options?.automatedCoverage ? automatedLineCoverage() : null,
    },
  };
}
