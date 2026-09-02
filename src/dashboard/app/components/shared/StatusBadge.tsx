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
  const dotClass =
    tone === "ok" ? "wd-status-dot-ok"
    : tone === "warn" ? "wd-status-dot-warn"
    : tone === "bad" ? "wd-status-dot-bad"
    : "wd-status-dot-off";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full wd-label wd-badge", tone === "bad" ? "text-accent" : "text-secondary", className)}
    >
      <span className={cn("wd-status-dot", dotClass, tone === "ok" && label.toLowerCase() === "running" ? "rec-pulse" : "")} />
      {label}
    </span>
  );
}
