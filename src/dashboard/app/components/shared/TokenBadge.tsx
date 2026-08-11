import React from "react";
import { cn, formatTokens } from "../../lib/utils.js";

export function TokenBadge({ tokens, className }: { tokens: number; className?: string }) {
  // Neutral ink for normal sizes; red is reserved for genuinely heavy reads.
  const style = { color: tokens < 1000 ? "var(--text-muted)" : "var(--accent)" };
  return (
    <span className={cn("font-mono text-xs", className)} style={style}>
      ~{formatTokens(tokens)} tok
    </span>
  );
}
