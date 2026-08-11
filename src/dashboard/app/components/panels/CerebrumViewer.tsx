import React, { useState, useMemo } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";

export function CerebrumViewer({ data }: { data: WolfData }) {
  const { cerebrum } = data;
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ preferences: true, learnings: true, doNotRepeat: true, decisions: false });

  const toggle = (key: string) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const matchesSearch = (text: string) => !search || text.toLowerCase().includes(search.toLowerCase());

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm" style={{ color: "var(--text-faint)" }}>
          Last updated: {cerebrum.lastUpdated || "—"} ·
          {cerebrum.preferences.length + cerebrum.learnings.length + cerebrum.doNotRepeat.length + cerebrum.decisions.length} entries
        </div>
      </div>
      <input type="text" placeholder="Search cerebrum..." value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
      />

      {/* Do-Not-Repeat — prominent */}
      <div className="rounded-xl mb-4 overflow-hidden" style={{ background: "var(--danger-subtle)", border: "1px solid rgba(220, 38, 38, 0.2)" }}>
        <button onClick={() => toggle("doNotRepeat")} className="w-full flex items-center justify-between px-5 py-3 transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(220, 38, 38, 0.08)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--danger)" }}>⊘</span>
            <h3 className="font-medium" style={{ color: "var(--danger)" }}>Do-Not-Repeat</h3>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(220, 38, 38, 0.1)", color: "var(--danger)" }}>{cerebrum.doNotRepeat.length}</span>
          </div>
          <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.doNotRepeat ? "▼" : "▶"}</span>
        </button>
        {expanded.doNotRepeat && (
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.doNotRepeat.filter((d) => matchesSearch(d.text)).map((entry, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "rgba(220, 38, 38, 0.05)", border: "1px solid rgba(220, 38, 38, 0.1)" }}>
                {entry.date && <span className="text-xs font-mono mr-2" style={{ color: "rgba(220, 38, 38, 0.6)" }}>[{entry.date}]</span>}
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{entry.text}</span>
              </div>
            ))}
            {cerebrum.doNotRepeat.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No entries yet.</p>}
          </div>
        )}
      </div>

      {/* User Preferences */}
      <div className="rounded-xl mb-4 overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => toggle("preferences")} className="w-full flex items-center justify-between px-5 py-3 transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--text-muted)" }}>◈</span>
            <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>User Preferences</h3>
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.preferences.length}</span>
          </div>
          <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.preferences ? "▼" : "▶"}</span>
        </button>
        {expanded.preferences && (
          <div className="px-5 pb-4">
            {cerebrum.preferences.filter(matchesSearch).map((item, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <span className="mt-1" style={{ color: "var(--text-faint)" }}>•</span>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{item}</span>
              </div>
            ))}
            {cerebrum.preferences.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No preferences recorded yet.</p>}
          </div>
        )}
      </div>

      {/* Key Learnings */}
      <div className="rounded-xl mb-4 overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => toggle("learnings")} className="w-full flex items-center justify-between px-5 py-3 transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--accent)" }}>◎</span>
            <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Key Learnings</h3>
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.learnings.length}</span>
          </div>
          <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.learnings ? "▼" : "▶"}</span>
        </button>
        {expanded.learnings && (
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.learnings.filter(matchesSearch).map((item, i) => (
              <div key={i} className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-surface-hover)", color: "var(--text-secondary)" }}>{item}</div>
            ))}
            {cerebrum.learnings.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No learnings recorded yet.</p>}
          </div>
        )}
      </div>

      {/* Decision Log */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => toggle("decisions")} className="w-full flex items-center justify-between px-5 py-3 transition-colors"
          onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--text-muted)" }}>⚖</span>
            <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Decision Log</h3>
            <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.decisions.length}</span>
          </div>
          <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.decisions ? "▼" : "▶"}</span>
        </button>
        {expanded.decisions && (
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.decisions.filter(matchesSearch).map((item, i) => (
              <div key={i} className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-surface-hover)", color: "var(--text-secondary)" }}>{item}</div>
            ))}
            {cerebrum.decisions.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No decisions logged yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
