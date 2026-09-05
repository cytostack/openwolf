import React, { useState } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";
import { useI18n } from "../../lib/i18n-context.js";

export function MemoryViewer({ data }: { data: WolfData }) {
  const { t } = useI18n();
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
        <input type="text" placeholder={t("Search memory...")} value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>{t("No sessions found.")}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((session, i) => {
            const isExpanded = expandedIdx === i;
            const totalTokens = session.entries.reduce((sum, e) => {
              const n = parseInt(e.tokens.replace(/[^0-9]/g, "")) || 0;
              return sum + n;
            }, 0);
            return (
              <div key={i} className="rounded-xl overflow-hidden" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                <button onClick={() => setExpandedIdx(isExpanded ? -1 : i)}
                  className="w-full flex items-center justify-between px-5 py-3 transition-colors"
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: "var(--text-faint)" }}>{isExpanded ? "▼" : "▶"}</span>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{session.date} {session.time}</span>
                    <span className="text-xs" style={{ color: "var(--text-faint)" }}>{t("{count} actions", { count: session.entries.length })}</span>
                  </div>
                  {totalTokens > 0 && <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>~{totalTokens} tok</span>}
                </button>
                {isExpanded && session.entries.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs uppercase" style={{ color: "var(--text-faint)" }}>
                          <th className="text-left px-4 py-2 w-16">{t("Time")}</th>
                          <th className="text-left px-4 py-2">{t("Action")}</th>
                          <th className="text-left px-4 py-2 hidden md:table-cell">{t("Files")}</th>
                          <th className="text-left px-4 py-2 hidden md:table-cell">{t("Outcome")}</th>
                          <th className="text-right px-4 py-2 w-20">{t("Tokens")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.entries.map((entry, j) => (
                          <tr key={j} style={{ borderBottom: "1px solid var(--border)" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                            <td className="px-4 py-2 text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.time}</td>
                            <td className="px-4 py-2 text-sm" style={{ color: "var(--text-secondary)" }}>{entry.action}</td>
                            <td className="px-4 py-2 text-sm hidden md:table-cell" style={{ color: "var(--text-muted)" }}>{entry.files}</td>
                            <td className="px-4 py-2 text-sm hidden md:table-cell" style={{ color: "var(--text-muted)" }}>{entry.outcome}</td>
                            <td className="px-4 py-2 text-xs font-mono text-right" style={{ color: "var(--text-faint)" }}>{entry.tokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
