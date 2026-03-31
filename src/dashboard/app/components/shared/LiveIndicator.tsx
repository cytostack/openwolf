import React from "react";

export function LiveIndicator({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-green" />
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
      <span className="w-2 h-2 rounded-full bg-zinc-500" />
      Reconnecting…
    </span>
  );
}
