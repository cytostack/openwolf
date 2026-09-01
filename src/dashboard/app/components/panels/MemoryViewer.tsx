import React, { useState } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";
import { CollapseCard } from "../shared/CollapseCard.js";

export function MemoryViewer({ data }: { data: WolfData }) {
  const { memory } = data;
  const [expandedIdx, setExpandedIdx] = useState<number>(0);
  const [search, setSearch] = useState("");

  const filtered = search
    ? memory.filter((s) =>
        s.entries.some((e) =>
          e.action.toLowerCase().includes(search.toLowerCase()) ||
          e.files.toLowerCase().includes(search.toLowerCase())
        )
      )
    : memory;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search memory..." ariaLabel="Search memory" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>No sessions found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((session, i) => {
            const isExpanded = expandedIdx === i;
            const totalTokens = session.entries.reduce((sum, e) => {
              const n = parseInt(e.tokens.replace(/[^0-9]/g, "")) || 0;
              return sum + n;
            }, 0);
            return (
              <CollapseCard key={i} expanded={isExpanded} onToggle={() => setExpandedIdx(isExpanded ? -1 : i)}
                header={
                  <>
                    <div className="flex items-center gap-3">
                      <span className="text-sm" style={{ color: "var(--text-faint)" }}>{isExpanded ? "▼" : "▶"}</span>
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{session.date} {session.time}</span>
                      <span className="text-xs" style={{ color: "var(--text-faint)" }}>{session.entries.length} actions</span>
                    </div>
                    {totalTokens > 0 && <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>~{totalTokens} tok</span>}
                  </>
                }
              >
                {session.entries.length > 0 && (
                  <table className="w-full">
                    <thead>
                      <tr className="text-xs uppercase" style={{ color: "var(--text-faint)" }}>
                        <th className="text-left px-4 py-2 w-16">Time</th>
                        <th className="text-left px-4 py-2">Action</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Files</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Outcome</th>
                        <th className="text-right px-4 py-2 w-20">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.entries.map((entry, j) => (
                        <tr key={j} className="wd-row" style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.time}</td>
                          <td className="px-4 py-2 text-sm" style={{ color: "var(--text-secondary)" }}>{entry.action}</td>
                          <td className="px-4 py-2 text-sm hidden md:table-cell" style={{ color: "var(--text-muted)" }}>{entry.files}</td>
                          <td className="px-4 py-2 text-sm hidden md:table-cell" style={{ color: "var(--text-muted)" }}>{entry.outcome}</td>
                          <td className="px-4 py-2 text-xs font-mono text-right" style={{ color: "var(--text-faint)" }}>{entry.tokens}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CollapseCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
