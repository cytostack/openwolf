import React from "react";

export function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 wd-label" style={{ color: "var(--accent)" }}>
      <span className="rounded-full rec-pulse" style={{ width: 8, height: 8, background: "var(--accent)" }} />
      live
    </span>
  );
}
