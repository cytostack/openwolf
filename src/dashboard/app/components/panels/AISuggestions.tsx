import React from "react";
import { relativeTime } from "../../lib/utils.js";
import type { WolfData } from "../../hooks/useWolfData.js";

const sections = [
  { key: "achievements", title: "Achievements", icon: "🏆", color: "#059669" },
  { key: "improvements", title: "Improvements", icon: "◆", color: "var(--text-secondary)" },
  { key: "next_tasks", title: "Next Tasks", icon: "📋", color: "#d97706" },
  { key: "risks", title: "Risks & Tech Debt", icon: "🛡", color: "#dc2626" },
] as const;

export function AISuggestions({ data }: { data: WolfData }) {
  const { suggestions, client } = data;

  if (!suggestions) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-4xl mb-3">✦</div>
        <h3 className="font-medium mb-1" style={{ color: "var(--text-secondary)" }}>AI suggestions generate weekly</h3>
        <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
          Run <code style={{ color: "var(--text-secondary)" }}>openwolf cron run project-suggestions</code> to generate now.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <span className="text-sm" style={{ color: "var(--text-faint)" }}>
          Generated: {suggestions.generated_at ? relativeTime(suggestions.generated_at) : "unknown"}
        </span>
        <button onClick={() => client?.send({ type: "trigger_task", task_id: "project-suggestions" })}
          className="px-3 py-1.5 text-xs rounded-lg transition-colors"
          style={{ background: "var(--bg-surface-hover)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
        >Regenerate</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map(({ key, title, icon, color }) => {
          const items = suggestions[key] || [];
          return (
            <div key={key} className="rounded-xl p-5" style={{ background: `${color}08`, border: `1px solid ${color}33` }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{icon}</span>
                <h3 className="font-medium" style={{ color }}>{title}</h3>
              </div>
              {items.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>None reported.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span className="mt-1 shrink-0" style={{ color: "var(--text-faint)" }}>•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
