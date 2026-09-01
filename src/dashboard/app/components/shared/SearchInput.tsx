import React from "react";

/**
 * Theme-aware search input. Keeps the native focus ring — the global
 * :focus-visible outline in globals.css provides keyboard focus.
 * `type="search"` gives a native clear affordance; aria-label makes it
 * reachable to screen readers (placeholder is not a label).
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "flex-1 rounded-lg px-3 py-2 text-sm",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
      }}
    />
  );
}
