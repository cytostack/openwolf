import { test, describe } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The stop hook nags "no semantic summary was written to memory.md" whenever
// countSemanticEntries returns 0. Rows in memory.md are `| HH:MM | ... |` — the
// format OPENWOLF.md documents, the reminder asks for, and the hook itself uses
// for its `Session end:` rows — so counting only `| YYYY-MM-DD` rows matched
// nothing and the reminder fired on every stop, forever.

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function wolfDirWith(memory: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolf-semantic-"));
  fs.writeFileSync(path.join(dir, "memory.md"), memory, "utf-8");
  return dir;
}

async function count(memory: string): Promise<number> {
  const { countSemanticEntries } = await import("../src/hooks/shared.ts");
  return countSemanticEntries(wolfDirWith(memory));
}

describe("countSemanticEntries", () => {
  test("counts an HH:MM row inside today's session block", async () => {
    assert.equal(
      await count(
        `# memory\n\n## Session: ${TODAY} 09:00\n\n| 09:30 | refactored the parser | src/parse.ts | green | ~4k |\n`,
      ),
      1,
    );
  });

  test("ignores the hook's own mechanical rows", async () => {
    assert.equal(
      await count(
        `# memory\n\n## Session: ${TODAY} 09:00\n\n` +
          `| 09:10 | Created src/a.ts | new file | ~20 |\n` +
          `| 09:11 | Edited src/a.ts | modified foo() | ~12 |\n` +
          `| 09:12 | Multi-edited src/a.ts | 3 edits | ~40 |\n` +
          `| 09:59 | Session end: 4 writes across 2 files (a.ts, b.ts) | 3 reads | ~5k |\n` +
          `| 09:40 | designqc: captured 3 routes | .wolf/designqc-captures | ok | ~7k |\n`,
      ),
      0,
    );
  });

  test("does not count rows from an earlier session", async () => {
    assert.equal(
      await count(
        `# memory\n\n## Session: ${YESTERDAY} 21:00\n\n| 22:55 | shipped the worker pool | src/pool.ts | green | ~5k |\n`,
      ),
      0,
    );
  });

  test("still honours a row with an explicit date prefix", async () => {
    assert.equal(await count(`# memory\n\n| ${TODAY} | wrote the handoff | STATUS.md | ok | ~5k |\n`), 1);
  });

  test("counts only the rows under today's header when sessions are stacked", async () => {
    assert.equal(
      await count(
        `# memory\n\n## Session: ${YESTERDAY} 21:00\n\n` +
          `| 22:55 | yesterday's summary | a.ts | ok | ~5k |\n\n` +
          `## Session: ${TODAY} 09:00\n\n` +
          `| 09:30 | today's summary | b.ts | ok | ~5k |\n` +
          `| 09:45 | another one today | c.ts | ok | ~5k |\n`,
      ),
      2,
    );
  });

  test("returns 0 when memory.md is missing", async () => {
    const { countSemanticEntries } = await import("../src/hooks/shared.ts");
    assert.equal(countSemanticEntries(fs.mkdtempSync(path.join(os.tmpdir(), "wolf-empty-"))), 0);
  });
});
