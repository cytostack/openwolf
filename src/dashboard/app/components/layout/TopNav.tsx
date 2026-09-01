import React from "react";
import { LiveIndicator } from "../shared/LiveIndicator.js";
import type { Theme } from "../../hooks/useTheme.js";

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "activity", label: "Activity" },
  { id: "cron", label: "Cron" },
  { id: "cerebrum", label: "Cerebrum" },
  { id: "memory", label: "Memory" },
  { id: "anatomy", label: "Anatomy" },
  { id: "bugs", label: "Bugs" },
  { id: "suggestions", label: "Insights" },
];

interface TopNavProps {
  activePanel: string;
  onNavigate: (panel: string) => void;
  daemonStatus: string;
  projectName: string;
  agents: string[];
  theme: Theme;
  onToggleTheme: () => void;
}

export function TopNav({ activePanel, onNavigate, daemonStatus, projectName, agents, theme, onToggleTheme }: TopNavProps) {
  return (
    <header className="sticky top-0 z-50 wd-topbar">
      <div className="max-w-7xl mx-auto px-5">
        <div className="flex items-center justify-between h-14">
          {/* Wordmark */}
          <button onClick={() => onNavigate("overview")} aria-label="OpenWolf overview" className="flex items-center gap-2.5 cursor-pointer" style={{ background: "none", border: "none", padding: 0 }}>
            <span aria-hidden="true" className="rounded-full wd-dot" style={{ width: 10, height: 10 }} />
            <span className="dot-display text-lg text-primary">OPENWOLF</span>
          </button>

          {/* Right cluster */}
          <div className="flex items-center gap-4">
            <span className="wd-label hidden md:inline truncate max-w-[180px] text-muted" title={projectName}>
              {projectName}
            </span>
            {agents.length > 0 && (
              <div className="hidden lg:flex items-center gap-1" title={`Wired agents: ${agents.join(", ")}`}>
                {agents.map((a) => (
                  <span key={a} title={a} aria-label={`Wired agent: ${a}`}
                    className="wd-label wd-avatar text-secondary flex items-center justify-center rounded-full"
                    style={{ width: 22, height: 22, fontSize: "0.55rem" }}>
                    {a.slice(0, 2).toUpperCase()}
                  </span>
                ))}
              </div>
            )}
            <LiveIndicator />
            <span className={`wd-label hidden sm:inline ${daemonStatus === "ok" || daemonStatus === "running" ? "text-secondary" : "text-accent"}`}>
              {daemonStatus === "ok" || daemonStatus === "running" ? "daemon on" : `daemon ${daemonStatus}`}
            </span>
            <button onClick={onToggleTheme} className="wd-pill px-3 py-1 cursor-pointer text-secondary"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? "light" : "dark"}
            </button>
          </div>
        </div>

        {/* Nav row */}
        <nav className="flex items-center gap-1 overflow-x-auto pb-2 -mb-px">
          {NAV_ITEMS.map((item) => {
            const active = activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="wd-label wd-nav px-3 py-1.5 rounded-full whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5"
                data-active={active}
              >
                {active && <span className="rounded-full wd-dot" style={{ width: 5, height: 5 }} />}
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
