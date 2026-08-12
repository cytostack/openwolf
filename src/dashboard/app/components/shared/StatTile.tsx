import React from "react";

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  variant?: "default" | "inverted" | "outline";
  accent?: boolean;          // red value — reserved for attention
  size?: "md" | "lg" | "xl";
  corner?: React.ReactNode;  // top-right slot (pill, dot, toggle)
  children?: React.ReactNode;
}

const sizeMap = { md: "text-3xl", lg: "text-5xl", xl: "text-6xl" };

export function StatTile({ label, value, sub, variant = "default", accent, size = "lg", corner, children }: StatTileProps) {
  const cardClass = variant === "inverted" ? "wd-card-inverted" : "wd-card";
  const mutedColor = variant === "inverted" ? "color-mix(in srgb, var(--invert-text) 55%, transparent)" : "var(--text-muted)";
  return (
    <div className={`${cardClass} p-5 flex flex-col justify-between gap-4 min-h-[132px]`}
      style={variant === "outline" ? { background: "transparent", border: "1px solid var(--border)" } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <span className="wd-label" style={{ color: mutedColor }}>{label}</span>
        {corner}
      </div>
      <div>
        <div className={`dot-display ${sizeMap[size]}`}
          style={{ color: accent ? "var(--accent)" : undefined }}>
          {value}
        </div>
        {sub && <p className="wd-label mt-2" style={{ color: mutedColor }}>{sub}</p>}
        {children}
      </div>
    </div>
  );
}
