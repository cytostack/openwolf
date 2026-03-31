import React from "react";
import { cn } from "../../lib/utils.js";
import type { Theme } from "../../hooks/useTheme.js";

const navItems = [
  { id: "overview", label: "Overview", icon: "◉" },
  { id: "activity", label: "Activity", icon: "◷" },
  { id: "tokens", label: "Tokens", icon: "◈" },
  { id: "cron", label: "Cron", icon: "⟳" },
  { id: "cerebrum", label: "Cerebrum", icon: "◎" },
  { id: "memory", label: "Memory", icon: "▤" },
  { id: "anatomy", label: "Anatomy", icon: "⊞" },
  { id: "bugs", label: "Bug Log", icon: "⚑" },
  { id: "suggestions", label: "AI Insights", icon: "✦" },
  { id: "designqc", label: "Design QC", icon: "🎨" },
];

interface SidebarProps {
  activePanel: string;
  onNavigate: (panel: string) => void;
  projectName: string;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Sidebar({ activePanel, onNavigate, projectName, theme, onToggleTheme }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 h-screen fixed left-0 top-0"
        style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border)" }}>
        <div className="p-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>🐺 OpenWolf</span>
            <button
              onClick={onToggleTheme}
              className="p-1.5 rounded-md transition-colors text-sm"
              style={{ color: "var(--text-muted)", background: "transparent" }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
          {projectName && (
            <p className="text-xs mt-1 truncate" style={{ color: "var(--text-secondary)" }} title={projectName}>{projectName}</p>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150"
              style={{
                color: activePanel === item.id ? "var(--text-primary)" : "var(--text-muted)",
                background: activePanel === item.id ? "var(--bg-surface-hover)" : "transparent",
                borderRight: activePanel === item.id ? "2px solid var(--accent)" : "2px solid transparent",
              }}
              onMouseEnter={e => { if (activePanel !== item.id) { e.currentTarget.style.background = "var(--bg-surface-hover)"; e.currentTarget.style.color = "var(--text-secondary)"; }}}
              onMouseLeave={e => { if (activePanel !== item.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
            Token-conscious AI project brain for Claude Code.
          </p>
          <div className="flex items-center justify-between">
            <a href="https://openwolf.com" target="_blank" rel="noopener noreferrer"
              className="text-xs underline transition-colors"
              style={{ color: "var(--accent)" }}
            >Docs</a>
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>v1.0.0</span>
          </div>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex overflow-x-auto"
        style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="flex-1 min-w-[64px] flex flex-col items-center py-2 px-1 text-[10px] transition-colors"
            style={{ color: activePanel === item.id ? "var(--accent)" : "var(--text-muted)" }}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}
