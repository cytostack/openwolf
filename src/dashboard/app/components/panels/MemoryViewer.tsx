import React, { useState } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";
import { CollapseCard } from "../shared/CollapseCard.js";
import { WdTable } from "../shared/WdTable.js";

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
                  <WdTable
                    columns={[
                      { key: "time", label: "Time", className: "w-16", cellClassName: "text-xs font-mono text-faint" },
                      { key: "action", label: "Action", cellClassName: "text-sm text-secondary" },
                      { key: "files", label: "Files", className: "hidden md:table-cell", cellClassName: "text-sm text-muted" },
                      { key: "outcome", label: "Outcome", className: "hidden md:table-cell", cellClassName: "text-sm text-muted" },
                      { key: "tokens", label: "Tokens", align: "right", className: "w-20", cellClassName: "text-xs font-mono text-faint" },
                    ]}
                    rows={session.entries.map((entry) => ({
                      time: entry.time,
                      action: entry.action,
                      files: entry.files,
                      outcome: entry.outcome,
                      tokens: entry.tokens,
                    }))}
                  />
                )}
              </CollapseCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
