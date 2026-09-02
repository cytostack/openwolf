import React from "react";

export function LiveIndicator() {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 wd-label text-accent">
      <span aria-hidden="true" className="rounded-full rec-pulse wd-dot wd-dot-8" />
      live
    </span>
  );
}
