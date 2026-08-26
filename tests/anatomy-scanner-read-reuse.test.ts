import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const mutableFs = require("node:fs") as typeof fs;
const distRoot = path.resolve(import.meta.dirname ?? ".", "..", "dist", "src");
const { scanProject } = await import(path.join(distRoot, "scanner", "anatomy-scanner.js"));
const { capDescription, extractDescription } = await import(
  path.join(distRoot, "scanner", "description-extractor.js")
);

const READ_BYTES = 12_288;

function makeProject(): { root: string; wolfDir: string; candidate: string; content: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openwolf-issue6-"));
  const wolfDir = path.join(root, ".wolf");
  const candidate = path.join(root, "fixture.md");
  const prefix = `${"x".repeat(READ_BYTES - 5)}\n# `;
  const content = `${prefix}€ scanner description\n`;

  assert.equal(Buffer.byteLength(prefix), READ_BYTES - 2);
  fs.mkdirSync(wolfDir, { recursive: true });
  fs.writeFileSync(candidate, content, "utf-8");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "OpenWolf Test"], { cwd: root });
  execFileSync("git", ["add", "fixture.md"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  return { root, wolfDir, candidate, content };
}

test("issue #6: scanner reuses its candidate read without output drift", async (t) => {
  const { root, wolfDir, candidate, content } = makeProject();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const originalReadFileSync = mutableFs.readFileSync;
  const originalOpenSync = mutableFs.openSync;
  const originalReadSync = mutableFs.readSync;
  const originalCloseSync = mutableFs.closeSync;
  const candidateFds = new Set<number>();
  let candidateReadFileCalls: unknown[][] = [];
  let readingCandidate = false;
  let candidateOpenCalls = 0;
  let candidateReadCalls = 0;
  let candidateCloseCalls = 0;
  let failCandidateRead = false;
  let totalOpenCalls = 0;
  let totalReadCalls = 0;

  const resetCalls = () => {
    candidateFds.clear();
    candidateReadFileCalls = [];
    readingCandidate = false;
    candidateOpenCalls = 0;
    candidateReadCalls = 0;
    candidateCloseCalls = 0;
    totalOpenCalls = 0;
    totalReadCalls = 0;
  };

  mutableFs.readFileSync = ((...args: unknown[]) => {
    if (args[0] !== candidate) {
      return (originalReadFileSync as (...callArgs: unknown[]) => unknown)(...args);
    }
    candidateReadFileCalls.push(args);
    readingCandidate = true;
    try {
      return (originalReadFileSync as (...callArgs: unknown[]) => unknown)(...args);
    } finally {
      readingCandidate = false;
    }
  }) as typeof mutableFs.readFileSync;
  mutableFs.openSync = ((...args: unknown[]) => {
    const fd = (originalOpenSync as (...callArgs: unknown[]) => number)(...args);
    totalOpenCalls++;
    if (args[0] === candidate && !readingCandidate) {
      candidateOpenCalls++;
      candidateFds.add(fd);
    }
    return fd;
  }) as typeof mutableFs.openSync;
  mutableFs.readSync = ((...args: unknown[]) => {
    totalReadCalls++;
    if (candidateFds.has(args[0] as number) && !readingCandidate) {
      candidateReadCalls++;
      if (failCandidateRead) throw new Error("injected candidate read failure");
    }
    return (originalReadSync as (...callArgs: unknown[]) => unknown)(...args);
  }) as typeof mutableFs.readSync;
  mutableFs.closeSync = ((...args: unknown[]) => {
    if (candidateFds.delete(args[0] as number)) candidateCloseCalls++;
    return (originalCloseSync as (...callArgs: unknown[]) => unknown)(...args);
  }) as typeof mutableFs.closeSync;
  syncBuiltinESMExports();

  try {
    resetCalls();
    const pathOnlyDescription = extractDescription(candidate);
    assert.equal(pathOnlyDescription, "�");
    assert.equal(candidateOpenCalls, 1, "path-only fallback must open the candidate");
    assert.equal(candidateReadCalls, 1, "path-only fallback must read the candidate");

    resetCalls();
    failCandidateRead = true;
    assert.equal(extractDescription(candidate), "");
    failCandidateRead = false;
    assert.equal(candidateCloseCalls, 1, "path-only fallback must close after a read failure");

    resetCalls();
    assert.equal(extractDescription(path.join(root, "package.json")), "Node.js package manifest");
    assert.equal(totalOpenCalls, 0, "known files remain I/O-free");
    assert.equal(totalReadCalls, 0, "known files remain I/O-free");

    const before = fs.statSync(candidate);
    const scanStarted = Date.now();
    resetCalls();
    const fileCount = await scanProject(wolfDir, root);
    const scanFinished = Date.now();

    assert.equal(fileCount, 1);
    assert.equal(candidateReadFileCalls.length, 1, "issue #6: scanner must read the candidate once");
    assert.equal(candidateOpenCalls, 0, "issue #6: scanner issued a second physical read");
    assert.equal(candidateReadCalls, 0, "issue #6: scanner issued a second physical read");
    assert.equal(candidateReadFileCalls[0].length, 1, "scanner read must not supply an encoding");

    resetCalls();
    assert.equal(extractDescription(candidate, ""), "");
    assert.equal(totalOpenCalls, 0, "supplied empty content must not open the candidate");
    assert.equal(totalReadCalls, 0, "supplied empty content must not read the candidate");

    const anatomyPath = path.join(wolfDir, "anatomy.md");
    const indexPath = path.join(wolfDir, "anatomy-index.json");
    const statePath = path.join(wolfDir, "_scan-state.json");
    assert.ok(fs.existsSync(anatomyPath));
    assert.ok(fs.existsSync(indexPath));
    assert.ok(fs.existsSync(statePath));

    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const entry = index.files["fixture.md"];
    const expectedDescription = capDescription(pathOnlyDescription);
    const expectedTokens = Math.ceil(content.length / 4);
    assert.deepEqual(Object.keys(entry).sort(), ["description", "hash", "mtimeMs", "size", "source", "tokens", "updatedAt"]);
    assert.equal(entry.description, expectedDescription);
    assert.equal(entry.tokens, expectedTokens);
    assert.equal(entry.hash, createHash("sha256").update(content).digest("hex").slice(0, 16));
    assert.equal(entry.size, Buffer.byteLength(content));
    assert.equal(entry.mtimeMs, before.mtimeMs);
    assert.equal(entry.source, "scan");
    assert.ok(Number.isFinite(Date.parse(entry.updatedAt)));
    assert.ok(Date.parse(entry.updatedAt) >= scanStarted && Date.parse(entry.updatedAt) <= scanFinished);

    const anatomy = fs.readFileSync(anatomyPath, "utf-8");
    assert.ok(anatomy.includes(`- \`fixture.md\` — ${expectedDescription} (~${expectedTokens} tok)`));
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    assert.equal(state.file_count, 1);
    assert.equal(state.git_head, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" }).trim());
    assert.ok(Number.isFinite(Date.parse(state.last_scanned)));
    assert.ok(Date.parse(state.last_scanned) >= scanStarted && Date.parse(state.last_scanned) <= scanFinished);
  } finally {
    mutableFs.readFileSync = originalReadFileSync;
    mutableFs.openSync = originalOpenSync;
    mutableFs.readSync = originalReadSync;
    mutableFs.closeSync = originalCloseSync;
    syncBuiltinESMExports();
  }
});
