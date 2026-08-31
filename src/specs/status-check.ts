// Drift guard between the two sources of truth that track active work:
// `.wolf/specs-state.json` (the SDD work pointer) and `.wolf/STATUS.md` (the
// "read first" handoff doc). A fresh session reads STATUS.md first per the
// OpenWolf protocol, so it must mention the active spec id or the resume path
// breaks silently.

export function statusMentionsActiveSpec(statusMd: string, activeSpec: string): boolean {
  return activeSpec.length > 0 && statusMd.includes(activeSpec);
}

const ACTIVE_SPEC_START = "<!-- openwolf:active-spec -->";
const ACTIVE_SPEC_END = "<!-- /openwolf:active-spec -->";

/**
 * Write (or update) the active-spec block in STATUS.md. Only the delimited
 * block is touched — all hand-written progress text outside it is preserved,
 * so STATUS.md stays the narrative source of truth while the CLI keeps the
 * one machine-owned line in sync with specs-state.json.
 */
export function syncActiveSpecToStatusMd(statusMd: string, activeSpec: string): string {
  const block = `${ACTIVE_SPEC_START}\nActive spec: ${activeSpec}\n${ACTIVE_SPEC_END}`;
  const startIdx = statusMd.indexOf(ACTIVE_SPEC_START);
  const endIdx = statusMd.indexOf(ACTIVE_SPEC_END);

  if (startIdx !== -1 && endIdx !== -1) {
    return statusMd.slice(0, startIdx) + block + statusMd.slice(endIdx + ACTIVE_SPEC_END.length);
  }
  return statusMd.trimEnd() + "\n\n" + block + "\n";
}
