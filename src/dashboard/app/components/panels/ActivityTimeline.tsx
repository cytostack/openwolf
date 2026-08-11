import React, { useState, useMemo } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";

export function ActivityTimeline({ data }: { data: WolfData }) {
  const { memory } = data;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [grouped, setGrouped] = useState(true);

  const filtered = useMemo(() => {
    let sessions = memory;
    if (filter === "today") {
      const today = new Date().toISOString().slice(0, 10);
      sessions = sessions.filter((s) => s.date === today);
    } else if (filter === "week") {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      sessions = sessions.filter((s) => s.date >= weekAgo);
    }
    if (search) {
      const lower = search.toLowerCase();
      sessions = sessions.map((s) => ({
        ...s,
        entries: s.entries.filter(
          (e) => e.action.toLowerCase().includes(lower) || e.files.toLowerCase().includes(lower)
        ),
      })).filter((s) => s.entries.length > 0);
    }
    return sessions;
  }, [memory, filter, search]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {["all", "today", "week"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1 text-xs rounded-md transition-colors"
              style={{
                background: filter === f ? "var(--bg-surface-hover)" : "transparent",
                color: filter === f ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >{f === "all" ? "All" : f === "today" ? "Today" : "This Week"}</button>
          ))}
        </div>
        <input type="text" placeholder="Search actions..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px] focus:outline-none"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
        <button onClick={() => setGrouped(!grouped)}
          className="px-3 py-1.5 text-xs rounded-lg"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >{grouped ? "Flat view" : "Group by session"}</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>No activity found.</div>
      ) : grouped ? (
        filtered.map((session, si) => (
          <div key={si} className="mb-4">
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>{session.date} {session.time} — {session.entries.length} actions</div>
            <div className="rounded-xl" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
              {session.entries.map((entry, ei) => (
                <div key={ei} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: ei < session.entries.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span className="text-xs font-mono w-12 shrink-0" style={{ color: "var(--text-faint)" }}>{entry.time}</span>
                  <span className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: entry.action.includes("Created") ? "var(--text-primary)" : entry.action.includes("Edited") ? "var(--text-muted)" : "var(--text-faint)" }} />
                  <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{entry.action}</span>
                  <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.tokens}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {filtered.flatMap((s) => s.entries.map((e, i) => (
            <div key={`${s.date}-${i}`} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-xs font-mono w-20 shrink-0" style={{ color: "var(--text-faint)" }}>{s.date}</span>
              <span className="text-xs font-mono w-12 shrink-0" style={{ color: "var(--text-faint)" }}>{e.time}</span>
              <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{e.action}</span>
              <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{e.tokens}</span>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
