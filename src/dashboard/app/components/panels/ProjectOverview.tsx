import React from "react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { relativeTime, formatTokens } from "../../lib/utils.js";
import type { WolfData } from "../../hooks/useWolfData.js";

export function ProjectOverview({ data }: { data: WolfData }) {
  const { identity, health, cronState, tokenLedger, anatomy, memory, project } = data;
  const lt = tokenLedger.lifetime;
  const projectName = project.name || identity.name;
  const projectDesc = project.description || "";

  return (
    <div>
      {/* Hero */}
      <div className="rounded-xl p-6 mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h2 className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>{projectName}</h2>
        {projectDesc && <p className="mt-1" style={{ color: "var(--text-muted)" }}>{projectDesc}</p>}
        <div className="flex items-center gap-4 mt-3">
          <StatusBadge status={cronState.engine_status} />
          {health.uptime_seconds > 0 && (
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>Uptime: {Math.floor(health.uptime_seconds / 3600)}h {Math.floor((health.uptime_seconds % 3600) / 60)}m</span>
          )}
          {cronState.last_heartbeat && (
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>Last heartbeat: {relativeTime(cronState.last_heartbeat)}</span>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Files Tracked</p>
          <p className="text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{anatomy.metadata.files}</p>
        </div>
        <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Sessions</p>
          <p className="text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{lt.total_sessions}</p>
        </div>
        <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Tokens Saved</p>
          <p className="text-2xl font-bold mt-1" style={{ color: "var(--accent)" }}>~{formatTokens(lt.estimated_savings_vs_bare_cli)}</p>
          {lt.total_tokens_estimated > 0 && (
            <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>
              {Math.round((lt.estimated_savings_vs_bare_cli / (lt.total_tokens_estimated + lt.estimated_savings_vs_bare_cli)) * 100)}% savings
            </p>
          )}
        </div>
      </div>

      {/* Quick activity */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Recent Activity</h3>
        {memory.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No activity yet. Start a Claude Code session to see activity here.</p>
        ) : (
          <div className="space-y-2">
            {memory.slice(0, 3).flatMap((session) =>
              session.entries.slice(0, 5).map((entry, i) => (
                <div key={`${session.date}-${i}`} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span className="text-xs font-mono w-12" style={{ color: "var(--text-faint)" }}>{entry.time}</span>
                  <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{entry.action}</span>
                  <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.tokens}</span>
                </div>
              ))
            ).slice(0, 5)}
          </div>
        )}
      </div>
    </div>
  );
}
