// Parses the tasks.md convention produced by the /tasks skill:
//   - [ ] T001 - description        (unchecked)
//   - [x] T002 - done               (checked, lowercase x)
//   - [X] T003 - done               (checked, uppercase X)
//   - [ ] T101 - [P] write test     (parallel marker sits after the id)

const UNCHECKED = /^\s*-\s*\[\s*\]\s*(T\d+)/;
const CHECKED = /^\s*-\s*\[[xX]\]\s*(T\d+)/;

/** First unchecked task id, or null when every task is checked / none exist. */
export function nextTask(tasksMd: string): string | null {
  for (const line of tasksMd.split(/\r?\n/)) {
    const m = line.match(UNCHECKED);
    if (m) return m[1];
  }
  return null;
}

export function taskCounts(
  tasksMd: string,
): { total: number; done: number; remaining: number } {
  let total = 0;
  let done = 0;
  for (const line of tasksMd.split(/\r?\n/)) {
    if (CHECKED.test(line)) {
      total++;
      done++;
    } else if (UNCHECKED.test(line)) {
      total++;
    }
  }
  return { total, done, remaining: total - done };
}
