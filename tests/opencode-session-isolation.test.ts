import * as assert from "node:assert";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

type OpenCodeHooks = {
  event(input: { event: { type: string; [key: string]: unknown } }): Promise<void>;
  "tool.execute.before"(input: { tool: string; sessionID: string }, output: { args: Record<string, unknown> }): Promise<void>;
  "tool.execute.after"(input: { tool: string; sessionID: string; args: Record<string, unknown> }, output: Record<string, unknown>): Promise<void>;
  stop(input: Record<string, unknown>): Promise<void>;
};

type SessionPathCall = {
  handler: "handleSessionStart" | "handlePreRead" | "handlePostRead" | "handlePostWrite" | "handleStop";
  sessionId: string;
  resolvedPath: string;
};

test("OpenCode keeps valid session persistence isolated and invalid IDs on the legacy fallback", async (t) => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "openwolf-opencode-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const resolverCalls: SessionPathCall[] = [];
  const auditGlobal = globalThis as typeof globalThis & {
    __openwolfSessionPathAudit?: (handler: SessionPathCall["handler"], sessionId: string, resolvedPath: string) => string;
  };
  auditGlobal.__openwolfSessionPathAudit = (handler, sessionId, resolvedPath) => {
    resolverCalls.push({ handler, sessionId, resolvedPath });
    return resolvedPath;
  };

  try {
    const sourceDir = path.resolve(import.meta.dirname, "../src/templates/opencode-plugin");
    const outputDir = path.join(root, "plugin");
    const sources = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".ts")).map((file) => path.join(sourceDir, file));
    const handlersByFile = new Map<string, SessionPathCall["handler"]>([
      ["session.js", "handleSessionStart"],
      ["pre-read.js", "handlePreRead"],
      ["post-read.js", "handlePostRead"],
      ["post-write.js", "handlePostWrite"],
      ["stop.js", "handleStop"],
    ]);
    fs.mkdirSync(outputDir);
    sources.forEach((source) => {
      const outputFile = path.basename(source).replace(/\.ts$/, ".js");
      const emitted = ts.transpileModule(fs.readFileSync(source, "utf-8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
        fileName: source,
      });
      let outputText = emitted.outputText;
      const handler = handlersByFile.get(outputFile);
      if (handler) {
        const resolverCall = "getSessionFilePath(directory, sessionId)";
        assert.strictEqual(outputText.split(resolverCall).length - 1, 1, `${handler} must call the shared resolver exactly once`);
        outputText = outputText.replace(
          resolverCall,
          `globalThis.__openwolfSessionPathAudit("${handler}", sessionId, ${resolverCall})`,
        );
      }
      fs.writeFileSync(path.join(outputDir, outputFile), outputText, "utf-8");
    });

    const { OpenWolf } = await import(pathToFileURL(path.join(outputDir, "index.js")).href);

    const wolfDir = path.join(root, ".wolf");
    fs.mkdirSync(wolfDir, { recursive: true });
    const sessionsDir = path.join(wolfDir, "hooks", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const expiredSessionPath = path.join(sessionsDir, "expired-session.json");
    const freshSessionPath = path.join(sessionsDir, "fresh-session.json");
    fs.writeFileSync(expiredSessionPath, "{}\n", "utf-8");
    fs.writeFileSync(freshSessionPath, "{}\n", "utf-8");
    const now = new Date();
    const expired = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(expiredSessionPath, expired, expired);
    fs.utimesSync(freshSessionPath, now, now);

    const hooks = await OpenWolf({ directory: root }) as OpenCodeHooks;
    const sessionA = "session-a1";
    const sessionB = "session-b2";

    await hooks.event({ event: { type: "session.created", properties: { info: { id: sessionA } } } });
    assert.ok(!fs.existsSync(expiredSessionPath), "session start must remove files older than seven days");
    assert.ok(fs.existsSync(freshSessionPath), "session start must retain fresh session files");
    await hooks.event({ event: { type: "session.created", properties: { info: { id: sessionB } } } });

    const readFile = path.join(root, "read-a.ts");
    fs.writeFileSync(readFile, "export const a = 1;\n", "utf-8");
    await hooks["tool.execute.before"]({ tool: "read", sessionID: sessionA }, { args: { filePath: readFile } });
    await hooks["tool.execute.after"]({ tool: "read", sessionID: sessionA, args: { filePath: readFile } }, { output: "export const a = 1;\n" });

    const writeFile = path.join(root, "write-b.ts");
    fs.writeFileSync(writeFile, "export const b = 2;\n", "utf-8");
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: sessionB, args: { filePath: writeFile, content: "export const b = 2;\n" } },
      {},
    );

    await hooks.stop({ sessionID: sessionA });
    await hooks.stop({ sessionID: sessionB });

    const sessionAPath = path.join(sessionsDir, `${sessionA}.json`);
    const sessionBPath = path.join(sessionsDir, `${sessionB}.json`);
    assert.notStrictEqual(sessionAPath, sessionBPath);
    assert.ok(fs.existsSync(sessionAPath), "session A must have its own persistent state file");
    assert.ok(fs.existsSync(sessionBPath), "session B must have its own persistent state file");

    const stateA = JSON.parse(fs.readFileSync(sessionAPath, "utf-8"));
    const stateB = JSON.parse(fs.readFileSync(sessionBPath, "utf-8"));
    assert.strictEqual(stateA.session_id, sessionA);
    assert.strictEqual(stateB.session_id, sessionB);
    assert.ok(stateA.files_read[readFile]);
    assert.deepStrictEqual(stateA.files_written, []);
    assert.ok(stateB.files_written.some((entry: { file: string }) => entry.file === writeFile));
    assert.deepStrictEqual(stateB.files_read, {});
    assert.strictEqual(stateA.stop_count, 1);
    assert.strictEqual(stateB.stop_count, 1);

    const ledger = JSON.parse(fs.readFileSync(path.join(wolfDir, "token-ledger.json"), "utf-8"));
    assert.deepStrictEqual(ledger.sessions.map((entry: { id: string }) => entry.id).sort(), [sessionA, sessionB]);

    const invalidId = "bad/id";
    await hooks.event({ event: { type: "session.created", sessionID: invalidId } });
    const fallbackPath = path.join(wolfDir, "hooks", "_session.json");
    assert.strictEqual(JSON.parse(fs.readFileSync(fallbackPath, "utf-8")).session_id, invalidId);
    await hooks.event({ event: { type: "session.created" } });
    assert.strictEqual(JSON.parse(fs.readFileSync(fallbackPath, "utf-8")).session_id, invalidId);

    assert.deepStrictEqual(
      [...new Set(resolverCalls.map(({ handler }) => handler))].sort(),
      ["handleSessionStart", "handlePreRead", "handlePostRead", "handlePostWrite", "handleStop"].sort(),
    );
    for (const call of resolverCalls.filter(({ sessionId }) => sessionId === sessionA || sessionId === sessionB)) {
      assert.strictEqual(call.resolvedPath, call.sessionId === sessionA ? sessionAPath : sessionBPath);
    }
  } finally {
    delete auditGlobal.__openwolfSessionPathAudit;
  }
});
