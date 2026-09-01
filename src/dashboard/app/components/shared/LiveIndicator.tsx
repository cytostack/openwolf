import React from "react";

export function LiveIndicator() {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 wd-label" style={{ color: "var(--accent)" }}>
      <span aria-hidden="true" className="rounded-full rec-pulse" style={{ width: 8, height: 8, background: "var(--accent)" }} />
      live
    </span>
  );
}
