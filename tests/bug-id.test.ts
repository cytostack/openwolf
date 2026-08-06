import { test, describe } from "node:test";
import * as assert from "node:assert";

import { nextBugId } from "../src/utils/bug-id.ts";
import { nextBugId as nextBugIdTemplate } from "../src/templates/opencode-plugin/fs.ts";

/** The rule this replaces, kept so every case can be shown to actually distinguish them. */
const lengthPlusOne = (bugs: ReadonlyArray<{ id?: string }>) =>
  `bug-${String(bugs.length + 1).padStart(3, "0")}`;

const log = (...ids: string[]) => ids.map((id) => ({ id }));

describe("nextBugId", () => {
  test("allocates from the high-water mark, not the count", () => {
    // Three entries, but ids run to 007 because four were added out of band.
    const bugs = log("bug-001", "bug-005", "bug-007");
    assert.equal(nextBugId(bugs), "bug-008");
    // The old rule hands back an id that is already taken - this is the whole defect.
    assert.equal(lengthPlusOne(bugs), "bug-004");
    assert.ok(!bugs.some((b) => b.id === nextBugId(bugs)), "allocated a live id");
  });

  test("collides on the very next call under the old rule, never under this one", () => {
    // Reproduces how one real log ended up with seven ids each holding two bugs.
    const bugs = [...log("bug-001", "bug-002", "bug-003")];
    bugs.splice(1, 1); // an entry is removed or renumbered by hand
    assert.equal(lengthPlusOne(bugs), "bug-003"); // already present
    assert.equal(nextBugId(bugs), "bug-004");
  });

  test("empty log starts at 001", () => {
    assert.equal(nextBugId([]), "bug-001");
  });

  test("gaps are not backfilled - ids stay monotonic and stable", () => {
    assert.equal(nextBugId(log("bug-001", "bug-009")), "bug-010");
  });

  test("ids past three digits keep counting instead of wrapping", () => {
    assert.equal(nextBugId(log("bug-999")), "bug-1000");
    assert.equal(nextBugId(log("bug-1082")), "bug-1083");
  });

  test("malformed and foreign ids are skipped, not thrown on", () => {
    const bugs = [
      { id: "bug-002" },
      { id: "bug-auto-500" },   // different namespace
      { id: "BUG-900" },        // wrong case
      { id: "bug-x" },
      { id: undefined },
      {} as { id?: string },
    ];
    assert.equal(nextBugId(bugs), "bug-003");
  });

  test("a custom prefix is honoured and does not match the default namespace", () => {
    const bugs = log("bug-100");
    assert.equal(nextBugId(bugs, "bug-auto-"), "bug-auto-001");
    assert.equal(nextBugId([{ id: "bug-auto-004" }], "bug-auto-"), "bug-auto-005");
  });

  test("the opencode-plugin copy behaves identically", () => {
    // The template is copied into user projects and cannot import outside its folder, so
    // the helper is duplicated there. Pin the two together or they will drift apart.
    for (const bugs of [[], log("bug-001"), log("bug-001", "bug-005", "bug-007"), log("bug-999")]) {
      assert.equal(nextBugIdTemplate(bugs), nextBugId(bugs));
    }
    assert.equal(nextBugIdTemplate([{ id: "bug-auto-004" }], "bug-auto-"), "bug-auto-005");
  });
});
