import React, { useState, useMemo } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";
import { CollapseCard } from "../shared/CollapseCard.js";

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
      <SearchInput value={search} onChange={setSearch} placeholder="Search cerebrum..." ariaLabel="Search cerebrum" className="w-full rounded-lg px-3 py-2 text-sm mb-4" />

      {/* Do-Not-Repeat — prominent */}
      <div className="space-y-4">
        <CollapseCard
          expanded={expanded.doNotRepeat}
          onToggle={() => toggle("doNotRepeat")}
          header={
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--danger)" }}>⊘</span>
              <h3 className="font-medium" style={{ color: "var(--danger)" }}>Do-Not-Repeat</h3>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)" }}>{cerebrum.doNotRepeat.length}</span>
              <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.doNotRepeat ? "▼" : "▶"}</span>
            </div>
          }
        >
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.doNotRepeat.filter((d) => matchesSearch(d.text)).map((entry, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "color-mix(in srgb, var(--danger) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 10%, transparent)" }}>
                {entry.date && <span className="text-xs font-mono mr-2" style={{ color: "color-mix(in srgb, var(--danger) 60%, transparent)" }}>[{entry.date}]</span>}
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{entry.text}</span>
              </div>
            ))}
            {cerebrum.doNotRepeat.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No entries yet.</p>}
          </div>
        </CollapseCard>

        {/* User Preferences */}
        <CollapseCard
          expanded={expanded.preferences}
          onToggle={() => toggle("preferences")}
          header={
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--text-muted)" }}>◈</span>
              <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>User Preferences</h3>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.preferences.length}</span>
              <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.preferences ? "▼" : "▶"}</span>
            </div>
          }
        >
          <div className="px-5 pb-4">
            {cerebrum.preferences.filter(matchesSearch).map((item, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <span className="mt-1" style={{ color: "var(--text-faint)" }}>•</span>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{item}</span>
              </div>
            ))}
            {cerebrum.preferences.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No preferences recorded yet.</p>}
          </div>
        </CollapseCard>

        {/* Key Learnings */}
        <CollapseCard
          expanded={expanded.learnings}
          onToggle={() => toggle("learnings")}
          header={
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--accent)" }}>◎</span>
              <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Key Learnings</h3>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.learnings.length}</span>
              <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.learnings ? "▼" : "▶"}</span>
            </div>
          }
        >
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.learnings.filter(matchesSearch).map((item, i) => (
              <div key={i} className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-surface-hover)", color: "var(--text-secondary)" }}>{item}</div>
            ))}
            {cerebrum.learnings.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No learnings recorded yet.</p>}
          </div>
        </CollapseCard>

        {/* Decision Log */}
        <CollapseCard
          expanded={expanded.decisions}
          onToggle={() => toggle("decisions")}
          header={
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--text-muted)" }}>◈</span>
              <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Decision Log</h3>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cerebrum.decisions.length}</span>
              <span className="text-sm" style={{ color: "var(--text-faint)" }}>{expanded.decisions ? "▼" : "▶"}</span>
            </div>
          }
        >
          <div className="px-5 pb-4 space-y-2">
            {cerebrum.decisions.filter(matchesSearch).map((item, i) => (
              <div key={i} className="rounded-lg p-3 text-sm" style={{ background: "var(--bg-surface-hover)", color: "var(--text-secondary)" }}>{item}</div>
            ))}
            {cerebrum.decisions.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>No decisions logged yet.</p>}
          </div>
        </CollapseCard>
      </div>
    </div>
  );
}
