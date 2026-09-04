import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { searchBugsFTS, normalizeSignature, sqliteAvailable } from "../src/hooks/bug-index.ts";

const haveSqlite = sqliteAvailable();

function makeWolfDir(bugs: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-fts-"));
  fs.writeFileSync(path.join(dir, "buglog.json"), JSON.stringify({ version: 1, bugs }), "utf-8");
  return dir;
}

describe("normalizeSignature", () => {
  test("collapses digits, strips hex ids and paths", () => {
    const sig = normalizeSignature("TypeError at /Users/x/app/src/foo.ts:42: cannot read 0xdeadbeef1234 of undefined (attempt 3)");
    assert.ok(!sig.includes("/"), sig);
    assert.ok(!sig.includes("deadbeef"), sig);
    assert.ok(!/\d/.test(sig), sig);
    assert.ok(sig.includes("typeerror"));
    assert.ok(sig.includes("cannot read"));
  });
});

describe("searchBugsFTS", { skip: !haveSqlite ? "node:sqlite unavailable on this Node" : false }, () => {
  const BUGS = [
    { id: "bug-001", error_message: "EADDRINUSE: address already in use 127.0.0.1:18790", root_cause: "two daemons sharing default port", fix: "reassign ports per project", tags: ["daemon", "ports"], file: "src/daemon/wolf-daemon.ts" },
    { id: "bug-002", error_message: "TypeError: cannot read properties of undefined (reading 'tokens')", root_cause: "post-read parsed tool_output instead of tool_response", fix: "parse tool_response shapes", tags: ["hooks"], file: "src/hooks/post-read.ts" },
    { id: "bug-003", error_message: "anatomy.md preamble duplicated blank lines on rewrite", root_cause: "parse-rewrite cycle grew blank edges", fix: "trimBlankEdges on preserved blocks", tags: ["anatomy"], file: "src/hooks/anatomy-store.ts" },
  ];

  test("finds bugs by error signature, ranked", () => {
    const dir = makeWolfDir(BUGS);
    const hits = searchBugsFTS(dir, "address already in use EADDRINUSE port collision", 5)!;
    assert.ok(hits.length >= 1);
    assert.strictEqual(hits[0].id, "bug-001");
  });

  test("matches across message + root_cause + tags", () => {
    const dir = makeWolfDir(BUGS);
    const hits = searchBugsFTS(dir, "tool_response undefined tokens", 5)!;
    assert.ok(hits.some((h) => h.id === "bug-002"));
  });

  test("rebuilds the index when buglog.json changes", () => {
    const dir = makeWolfDir(BUGS);
    assert.ok(searchBugsFTS(dir, "EADDRINUSE", 5)!.length >= 1);
    // Add a new bug with a bumped mtime; the index must pick it up.
    const updated = { version: 1, bugs: [...BUGS, { id: "bug-004", error_message: "zebra quantum flux failure", root_cause: "cosmic rays", fix: "reboot", tags: [], file: "x.ts" }] };
    fs.writeFileSync(path.join(dir, "buglog.json"), JSON.stringify(updated), "utf-8");
    const future = Date.now() + 5000;
    fs.utimesSync(path.join(dir, "buglog.json"), new Date(future), new Date(future));
    const hits = searchBugsFTS(dir, "zebra quantum flux", 5)!;
    assert.strictEqual(hits[0]?.id, "bug-004");
  });

  test("returns empty for no matches, null for empty buglog", () => {
    const dir = makeWolfDir(BUGS);
    assert.deepStrictEqual(searchBugsFTS(dir, "completely unrelated nonsense zzz", 5), []);
    const empty = makeWolfDir([]);
    assert.strictEqual(searchBugsFTS(empty, "anything", 5), null);
  });
});
