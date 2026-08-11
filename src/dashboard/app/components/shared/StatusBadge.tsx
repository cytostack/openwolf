import React from "react";
import { cn } from "../../lib/utils.js";

// Monochrome status system: ok = neutral ink dot, warning = outlined red dot,
// error = filled red. Status is never carried by color alone — the label
// always names the state.
type Tone = "ok" | "warn" | "bad" | "off";

const toneOf: Record<string, Tone> = {
  healthy: "ok", running: "ok", success: "ok", ok: "ok", enabled: "ok", initialized: "ok",
  warning: "warn", retrying: "warn", degraded: "warn",
  error: "bad", failed: "bad", stopped: "bad",
  disabled: "off", unknown: "off",
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  // Never trust the incoming value: a failed/malformed API response can leave
  // this undefined, and a crash here white-screens the whole dashboard.
  const label = typeof status === "string" && status.trim() ? status : "unknown";
  const tone = toneOf[label.toLowerCase()] ?? "off";
  const dotStyle: React.CSSProperties =
    tone === "ok" ? { background: "var(--ok)" }
    : tone === "warn" ? { background: "transparent", border: "1.5px solid var(--accent)" }
    : tone === "bad" ? { background: "var(--accent)" }
    : { background: "var(--text-faint)" };
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full wd-label", className)}
      style={{
        border: "1px solid var(--border)",
        color: tone === "bad" ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      <span className={cn("rounded-full", tone === "ok" && label.toLowerCase() === "running" ? "rec-pulse" : "")}
        style={{ width: 6, height: 6, ...dotStyle }} />
      {label}
    </span>
  );
}
