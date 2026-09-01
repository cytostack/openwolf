import React from "react";

/**
 * Theme-aware collapsible card. Replaces the per-panel hand-written
 * onMouseEnter/onMouseLeave hover + bare ▶/▼ toggle: hover comes from a CSS
 * class (no per-frame style writes) and the header button carries
 * aria-expanded for screen readers.
 */
export function CollapseCard({
  expanded,
  onToggle,
  header,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl overflow-hidden wd-panel">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="wd-collapse-head w-full flex items-center justify-between px-5 py-3 transition-colors cursor-pointer"
      >
        {header}
      </button>
      {expanded && <div className="wd-divide-top">{children}</div>}
    </div>
  );
}
