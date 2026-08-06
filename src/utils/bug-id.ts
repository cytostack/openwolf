/**
 * Allocate the next bug id from the HIGH-WATER MARK of the ids already present.
 *
 * The previous rule was `bugs.length + 1`, which treats the array length as an id
 * generator. It is not one. Any entry that arrives out of band — a hand-written bug, an id
 * claimed by another tool, a manual renumber, an entry deleted from the middle — moves the
 * numbers away from the count, and from then on `length + 1` re-issues an id that is
 * already in use.
 *
 * The failure is silent and cumulative: two entries share an id, `related_bugs` pointers
 * become ambiguous about which of the two they meant, and dedupe-by-id starts merging
 * unrelated bugs. Nothing raises an error at any point. In one real log seven separate ids
 * each ended up holding two different bugs before anybody noticed.
 *
 * Reading the ids instead of counting them makes allocation correct however the entries got
 * there. Ids that do not match the expected shape are skipped rather than throwing, so a
 * hand-edited log still allocates sensibly instead of failing closed.
 */
export function nextBugId(bugs: ReadonlyArray<{ id?: string }>, prefix = "bug-"): string {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let max = 0;
  for (const bug of bugs) {
    const match = pattern.exec(String(bug?.id ?? ""));
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
