import React, { useState } from "react";
import type { WolfData, BugEntry } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";
import { EmptyState } from "../shared/EmptyState.js";
import { CollapseCard } from "../shared/CollapseCard.js";

export function BugLog({ data }: { data: WolfData }) {
  const { buglog } = data;
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = search
    ? buglog.bugs.filter((b: BugEntry) =>
        b.error_message.toLowerCase().includes(search.toLowerCase()) ||
        b.root_cause.toLowerCase().includes(search.toLowerCase()) ||
        b.fix.toLowerCase().includes(search.toLowerCase()) ||
        b.tags.some((t: string) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : buglog.bugs;

  if (buglog.bugs.length === 0) {
    return (
      <EmptyState icon="◆" title="No bugs logged yet"
        description="When you encounter and fix bugs, they'll appear here for future reference." />
    );
  }

  const allTags = buglog.bugs.flatMap((b: BugEntry) => b.tags);
  const tagCounts = new Map<string, number>();
  for (const tag of allTags) {
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search bugs..." ariaLabel="Search bugs" />
        <span className="text-sm text-faint">{buglog.bugs.length} bugs logged</span>
      </div>

      {topTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {topTags.map(([tag, count]) => (
            <button key={tag} onClick={() => setSearch(tag)}
              className="px-2 py-1 text-xs rounded-full wd-chip"
            >{tag} ({count})</button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((bug: BugEntry) => {
          const isExpanded = expandedId === bug.id;
          return (
            <CollapseCard
              key={bug.id}
              expanded={isExpanded}
              onToggle={() => setExpandedId(isExpanded ? null : bug.id)}
              header={
                <div className="flex items-start gap-3 text-left w-full">
                  <span className="text-sm mt-0.5 text-faint">{isExpanded ? "▼" : "▶"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate text-primary">{bug.error_message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-faint">{bug.file}</span>
                      <span className="text-xs text-faint">{bug.timestamp?.slice(0, 10)}</span>
                    </div>
                  </div>
                  {bug.occurrences > 1 && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs wd-warning-chip">
                      Seen {bug.occurrences}x
                    </span>
                  )}
                </div>
              }
            >
              <div className="px-5 py-4 space-y-3">
                <div>
                  <p className="text-xs uppercase mb-1 text-faint">Error Message</p>
                  <pre className="text-sm rounded-lg p-3 overflow-x-auto font-mono wd-pre-danger">{bug.error_message}</pre>
                </div>
                <div>
                  <p className="text-xs uppercase mb-1 text-faint">Root Cause</p>
                  <p className="text-sm text-secondary">{bug.root_cause}</p>
                </div>
                <div>
                  <p className="text-xs uppercase mb-1 text-faint">Fix</p>
                  <pre className="text-sm rounded-lg p-3 overflow-x-auto font-mono wd-pre-accent">{bug.fix}</pre>
                </div>
                <div className="flex flex-wrap gap-2">
                  {bug.tags.map((tag: string) => (
                    <span key={tag} className="px-2 py-0.5 text-xs rounded-full wd-chip">{tag}</span>
                  ))}
                </div>
              </div>
            </CollapseCard>
          );
        })}
      </div>
    </div>
  );
}
