import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { createRequire, registerHooks, syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process") as typeof import("node:child_process");
const capturedExecFileSync = childProcess.execFileSync;

const scratch = process.env.TMPDIR;
assert.ok(scratch, "TMPDIR must name the session scratchpad");
assert.ok(path.isAbsolute(scratch), "TMPDIR must be an absolute scratchpad path");
assert.ok(fs.existsSync(scratch), "TMPDIR must exist");

let hooks: ReturnType<typeof registerHooks> | undefined;
let benchCommand: (typeof import("../src/cli/bench.ts"))["benchCommand"];
const originalCwd = process.cwd();
const originalExitCode = process.exitCode;
const originalLog = console.log;

type Command = { file: string; args: string[]; cwd?: string };
type RunOptions = {
  format?: "sha1" | "sha256";
  lsRemote?: string | Error;
  moveBeforeFirstClone?: boolean;
  failFetch?: boolean;
  failCheckout?: boolean;
  revParseReplies?: string[];
};

type Verification = { commandIndex: number; head: string };

let current: {
  fixture: string;
  commands: Command[];
  verifiedHeads: Verification[];
  actionHeads: string[];
  initHeads: string[];
  sourceA: string;
  sourceB?: string;
  options: RunOptions;
  moved: boolean;
} | undefined;

function git(args: string[], cwd?: string): string {
  return String(capturedExecFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).trim();
}

function createFixture(root: string, format: "sha1" | "sha256" = "sha1"): { fixture: string; sourceA: string } {
  const fixture = path.join(root, "source");
  fs.mkdirSync(fixture);
  git(["init", "--initial-branch=main", `--object-format=${format}`], fixture);
  git(["config", "user.email", "bench@example.test"], fixture);
  git(["config", "user.name", "Benchmark Fixture"], fixture);
  fs.writeFileSync(path.join(fixture, "fixture.txt"), "A\n");
  git(["add", "fixture.txt"], fixture);
  git(["commit", "-m", "fixture A"], fixture);
  return { fixture, sourceA: git(["rev-parse", "HEAD"], fixture) };
}

function advanceFixture(fixture: string): string {
  fs.writeFileSync(path.join(fixture, "fixture.txt"), "B\n");
  git(["add", "fixture.txt"], fixture);
  git(["commit", "-m", "fixture B"], fixture);
  return git(["rev-parse", "HEAD"], fixture);
}

function benchFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.startsWith("openwolf-bench-") && name.endsWith(".json"));
}

const realExecFileSync = childProcess.execFileSync;

function installHarness(): void {
  hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        const candidateTsUrl = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (fs.existsSync(fileURLToPath(candidateTsUrl))) return nextResolve(candidateTsUrl.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  childProcess.execFileSync = ((file: string, args: readonly string[] = [], options: { cwd?: string } = {}) => {
  const run = current;
  const argv = [...args];
  run?.commands.push({ file, args: argv, cwd: options.cwd });
  const commandIndex = run ? run.commands.length - 1 : -1;
  if (!run) return realExecFileSync(file, argv, options);

  if (file === "git" && argv[0] === "ls-remote") {
    if (run.options.lsRemote instanceof Error) throw run.options.lsRemote;
    return Buffer.from(run.options.lsRemote ?? `${run.sourceA}\tHEAD\n`);
  }
  if (file === "git" && argv[0] === "clone" && run.options.moveBeforeFirstClone && !run.moved) {
    run.sourceB = advanceFixture(run.fixture);
    run.moved = true;
  }
  if (file === "git" && argv[0] === "fetch" && run.options.failFetch) throw new Error("sentinel fetch failure");
  if (file === "git" && argv[0] === "checkout" && run.options.failCheckout) throw new Error("sentinel checkout failure");
  if (file === "git" && argv[0] === "rev-parse" && argv[1] === "HEAD") {
    const output = run.options.revParseReplies?.length
      ? Buffer.from(`${run.options.revParseReplies.shift()}\n`)
      : realExecFileSync(file, argv, options);
    run.verifiedHeads.push({ commandIndex, head: String(output).trim() });
    return output;
  }
  if (file === "git") return realExecFileSync(file, argv, options);
  if (file === process.execPath) {
    run.initHeads.push(git(["rev-parse", "HEAD"], options.cwd));
    return Buffer.alloc(0);
  }
  if (file === "claude") {
    run.actionHeads.push(git(["rev-parse", "HEAD"], options.cwd));
    if (!run.moved) {
      run.sourceB = advanceFixture(run.fixture);
      run.moved = true;
    }
    return Buffer.alloc(0);
  }
  return realExecFileSync(file, argv, options);
  }) as typeof childProcess.execFileSync;
  syncBuiltinESMExports();
}

function cleanupScratch(): void {
  if (!fs.existsSync(scratch)) return;
  for (const name of fs.readdirSync(scratch).filter((name) => name.startsWith("bench-source-revision-") || name.startsWith("owbench-"))) {
    fs.rmSync(path.join(scratch, name), { recursive: true, force: true });
  }
}

function teardownHarness(): void {
  try {
    hooks?.deregister();
  } finally {
    childProcess.execFileSync = realExecFileSync;
    syncBuiltinESMExports();
    hooks = undefined;
    console.log = originalLog;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    current = undefined;
    cleanupScratch();
  }
}

try {
  installHarness();
  ({ benchCommand } = await import("../src/cli/bench.ts"));
} catch (error) {
  teardownHarness();
  throw error;
}

function invoke(options: RunOptions = {}): {
  sourceA: string;
  sourceB?: string;
  commands: Command[];
  verifiedHeads: Verification[];
  actionHeads: string[];
  initHeads: string[];
  logs: string[];
  outputDir: string;
  exitCode: number | undefined;
} {
  const caseDir = fs.mkdtempSync(path.join(scratch, "bench-source-revision-"));
  const outputDir = path.join(caseDir, "output");
  fs.mkdirSync(outputDir);
  const { fixture, sourceA } = createFixture(caseDir, options.format);
  const commands: Command[] = [];
  const verifiedHeads: Verification[] = [];
  const actionHeads: string[] = [];
  const initHeads: string[] = [];
  const logs: string[] = [];
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;
  const previousLog = console.log;
  current = { fixture, commands, verifiedHeads, actionHeads, initHeads, sourceA, options: { ...options }, moved: false };
  try {
    process.chdir(outputDir);
    process.exitCode = undefined;
    console.log = (...values: unknown[]) => logs.push(values.join(" "));
    benchCommand({ repo: pathToFileURL(fixture).href, task: "01-bugfix", repeats: "1", yes: true });
    return { sourceA, sourceB: current.sourceB, commands, verifiedHeads, actionHeads, initHeads, logs, outputDir, exitCode: process.exitCode };
  } finally {
    console.log = previousLog;
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    current = undefined;
  }
}

function assertSourceLine(result: ReturnType<typeof invoke>): void {
  const sourceLines = result.logs.filter((line) => line.startsWith("Source commit: "));
  assert.deepEqual(sourceLines, [`Source commit: ${result.sourceA}`]);
}

function assertEachArmVerifiedBeforeActions(result: ReturnType<typeof invoke>): void {
  const cloneIndexes = result.commands
    .map((command, index) => command.file === "git" && command.args[0] === "clone" ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(cloneIndexes.length, 2, "one repeat must prepare both benchmark arms");

  for (const [arm, cloneIndex] of cloneIndexes.entries()) {
    const nextCloneIndex = cloneIndexes[arm + 1] ?? result.commands.length;
    const finalVerificationIndex = result.commands
      .map((command, index) => index > cloneIndex && index < nextCloneIndex && command.file === "git" && command.args[0] === "rev-parse" && command.args[1] === "HEAD" ? index : -1)
      .filter((index) => index >= 0)
      .at(-1);
    assert.notEqual(finalVerificationIndex, undefined, `arm ${arm} must have a final HEAD verification`);
    assert.equal(result.verifiedHeads.find((verification) => verification.commandIndex === finalVerificationIndex)?.head, result.sourceA, `arm ${arm} final HEAD verification must equal the pinned commit`);

    const actionIndexes = result.commands
      .map((command, index) => index > cloneIndex && index < nextCloneIndex && (command.file === process.execPath || command.file === "claude") ? index : -1)
      .filter((index) => index >= 0);
    assert.ok(actionIndexes.length > 0, `arm ${arm} must run its expected action`);
    assert.ok(actionIndexes.every((index) => index > finalVerificationIndex), `arm ${arm} actions must follow its final exact HEAD verification`);
  }
}

function assertNoArtifact(result: ReturnType<typeof invoke>): void {
  assert.deepEqual(benchFiles(result.outputDir), []);
  assert.deepEqual(fs.readdirSync(scratch).filter((name) => name.startsWith("owbench-")), []);
}

test("pins one source commit across branch movement", () => {
  const result = invoke();
  try {
    assert.ok(result.sourceB, "fixture branch must advance to B between arms");
    assert.deepEqual(result.actionHeads, [result.sourceA, result.sourceA], "both benchmark arms must execute the invocation-pinned commit");
    assert.deepEqual(result.initHeads, [result.sourceA], "OpenWolf initialization must use the verified invocation-pinned commit");
    assertEachArmVerifiedBeforeActions(result);

    const lsRemote = result.commands.filter((command) => command.file === "git" && command.args[0] === "ls-remote");
    const clones = result.commands.filter((command) => command.file === "git" && command.args[0] === "clone");
    assert.equal(lsRemote.length, 1, "one invocation must resolve HEAD once");
    assert.ok(result.commands.indexOf(lsRemote[0]) < result.commands.indexOf(clones[0]), "resolution precedes clone");
    assert.deepEqual(lsRemote[0].args.slice(1), [pathToFileURL(path.join(path.dirname(result.outputDir), "source")).href, "HEAD"]);

    const movedClone = clones[1];
    const movedCloneIndex = result.commands.indexOf(movedClone);
    const movedFetch = result.commands.findIndex((command, index) => index > movedCloneIndex && command.file === "git" && command.args[0] === "fetch");
    const movedCheckout = result.commands.findIndex((command, index) => index > movedFetch && command.file === "git" && command.args[0] === "checkout");
    const movedVerify = result.commands.findIndex((command, index) => index > movedCheckout && command.file === "git" && command.args[0] === "rev-parse");
    assert.ok(movedFetch > movedCloneIndex && movedCheckout > movedFetch && movedVerify > movedCheckout, "moved clone is fetched, detached, and verified before action");

    const artifact = JSON.parse(fs.readFileSync(path.join(result.outputDir, benchFiles(result.outputDir)[0]), "utf8"));
    assert.equal(artifact.results.length, 2);
    assert.deepEqual(artifact.results.map((row: { source_commit: string }) => row.source_commit), [result.sourceA, result.sourceA]);
    assertSourceLine(result);
    assert.ok(result.logs.includes("    bare     input 0 | output 0 | cache_read 0 | cache_creation 0 | api_calls 0 | completed 1/1 | bash re-run rate 0.0%"));
    assert.ok(result.logs.includes("    openwolf input 0 | output 0 | cache_read 0 | cache_creation 0 | api_calls 0 | completed 1/1 | bash re-run rate 0.0%"));
    assert.ok(result.logs.includes("\n  Gate guidance: openwolf arm should show lower output-side context growth"));
  } finally {
    fs.rmSync(path.dirname(result.outputDir), { recursive: true, force: true });
  }
});

test("preserves full SHA-1 and SHA-256 provenance", () => {
  for (const format of ["sha1", "sha256"] as const) {
    const result = invoke({ format });
    assert.match(result.sourceA, format === "sha1" ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/);
    const artifact = JSON.parse(fs.readFileSync(path.join(result.outputDir, benchFiles(result.outputDir)[0]), "utf8"));
    assert.deepEqual(artifact.results.map((row: { source_commit: string }) => row.source_commit), [result.sourceA, result.sourceA]);
    assertSourceLine(result);
    fs.rmSync(path.dirname(result.outputDir), { recursive: true, force: true });
  }
});

test("rejects ambiguous advertised revisions before cloning", () => {
  const malformed = ["", "ABCDEF\tHEAD\n", "abc\tHEAD\n", `${"a".repeat(40)}\trefs/heads/main\n`, `${"a".repeat(40)}\tHEAD extra\n`, `${"a".repeat(40)}\tHEAD\n${"a".repeat(40)}\tHEAD\n`, `${"a".repeat(40)}\tHEAD\n${"b".repeat(40)}\tHEAD\n`];
  for (const lsRemote of malformed) {
    const result = invoke({ lsRemote });
    assert.equal(result.exitCode, 1);
    assert.equal(result.commands.filter((command) => command.file === "git" && command.args[0] === "clone").length, 0);
    assert.equal(result.initHeads.length, 0);
    assert.equal(result.actionHeads.length, 0);
    assertNoArtifact(result);
    fs.rmSync(path.dirname(result.outputDir), { recursive: true, force: true });
  }
});

test("fails closed before actions when resolution or pinning fails", () => {
  const cases: RunOptions[] = [
    { lsRemote: new Error("sentinel resolution failure") },
    { moveBeforeFirstClone: true, failFetch: true },
    { moveBeforeFirstClone: true, failCheckout: true },
    { revParseReplies: ["a".repeat(40), "b".repeat(40)] },
  ];
  for (const options of cases) {
    const result = invoke(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.initHeads.length, 0);
    assert.equal(result.actionHeads.length, 0);
    assertNoArtifact(result);
    assert.ok(result.logs.some((line) => /source (resolution|preparation) failed/.test(line)));
    fs.rmSync(path.dirname(result.outputDir), { recursive: true, force: true });
  }
});

test("refuses without consent before source preparation", () => {
  const caseDir = fs.mkdtempSync(path.join(scratch, "bench-source-revision-"));
  const { fixture } = createFixture(caseDir);
  const commands: Command[] = [];
  const previousLog = console.log;
  const previousExitCode = process.exitCode;
  current = { fixture, commands, verifiedHeads: [], actionHeads: [], initHeads: [], sourceA: git(["rev-parse", "HEAD"], fixture), options: {}, moved: false };
  try {
    console.log = () => undefined;
    process.exitCode = undefined;
    benchCommand({ repo: pathToFileURL(fixture).href, task: "01-bugfix", repeats: "1" });
    assert.equal(process.exitCode, 1);
    assert.equal(commands.filter((command) => command.file === "git" && ["ls-remote", "clone"].includes(command.args[0])).length, 0);
    assert.equal(commands.filter((command) => command.file === "claude" || command.file === process.execPath).length, 0);
  } finally {
    console.log = previousLog;
    process.exitCode = previousExitCode;
    current = undefined;
    fs.rmSync(caseDir, { recursive: true, force: true });
  }
});

test.after(() => {
  teardownHarness();
  assert.deepEqual(fs.readdirSync(scratch).filter((name) => name.startsWith("bench-source-revision-") || name.startsWith("owbench-")), []);
});
