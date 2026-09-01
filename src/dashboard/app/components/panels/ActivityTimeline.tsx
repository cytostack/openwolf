import React, { useState, useMemo } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";

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
        <div className="flex gap-1 rounded-lg p-1 wd-panel">
          {["all", "today", "week"].map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs rounded-md transition-colors text-muted ${filter === f ? "wd-seg-active" : ""}`}
            >{f === "all" ? "All" : f === "today" ? "Today" : "This Week"}</button>
          ))}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search actions..." ariaLabel="Search actions" />
        <button onClick={() => setGrouped(!grouped)} className="px-3 py-1.5 text-xs rounded-lg wd-panel-muted">
          {grouped ? "Flat view" : "Group by session"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted">No activity found.</div>
      ) : grouped ? (
        filtered.map((session, si) => (
          <div key={si} className="mb-4">
            <div className="text-sm font-medium mb-2 text-muted">{session.date} {session.time} — {session.entries.length} actions</div>
            <div className="rounded-xl wd-panel">
              {session.entries.map((entry, ei) => (
                <div key={ei} className={`flex items-center gap-4 px-4 py-3 ${ei < session.entries.length - 1 ? "wd-divide" : ""}`}>
                  <span className="text-xs font-mono w-12 shrink-0 text-faint">{entry.time}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${entry.action.includes("Created") ? "wd-bullet-ink" : entry.action.includes("Edited") ? "wd-bullet-muted" : "wd-bullet-faint"}`} />
                  <span className="text-sm flex-1 text-secondary">{entry.action}</span>
                  <span className="text-xs font-mono text-faint">{entry.tokens}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl wd-panel">
          {filtered.flatMap((s) => s.entries.map((e, i) => (
            <div key={`${s.date}-${i}`} className="flex items-center gap-4 px-4 py-3 wd-divide">
              <span className="text-xs font-mono w-20 shrink-0 text-faint">{s.date}</span>
              <span className="text-xs font-mono w-12 shrink-0 text-faint">{e.time}</span>
              <span className="text-sm flex-1 text-secondary">{e.action}</span>
              <span className="text-xs font-mono text-faint">{e.tokens}</span>
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
