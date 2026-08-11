import React, { useState } from "react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { relativeTime, formatSchedule } from "../../lib/utils.js";
import { dashboardFetch } from "../../lib/wolf-client.js";
import type { WolfData } from "../../hooks/useWolfData.js";

export function CronStatus({ data }: { data: WolfData }) {
  const { cronManifest, cronState, client } = data;
  const [showDeadLetters, setShowDeadLetters] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [runningTasks, setRunningTasks] = useState<Record<string, "running" | "ok" | "error">>({});

  const getTaskStatus = (taskId: string): string => {
    if (cronState.dead_letter_queue.some((d: any) => d.task_id === taskId)) return "failed";
    const last = cronState.execution_log.filter((e: any) => e.task_id === taskId).sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp))[0];
    return last?.status || "ok";
  };

  const getLastRun = (taskId: string): string => {
    const last = cronState.execution_log.filter((e: any) => e.task_id === taskId).sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp))[0];
    return last ? relativeTime(last.timestamp) : "never";
  };

  // Run Now over authenticated HTTP (from PR #4 by @MyEditHub): the old
  // client?.send() silently dropped when the WebSocket wasn't OPEN.
  const clearSoon = (taskId: string) =>
    setTimeout(() => setRunningTasks(prev => { const n = { ...prev }; delete n[taskId]; return n; }), 3000);
  const triggerTask = (taskId: string) => {
    setRunningTasks(prev => ({ ...prev, [taskId]: "running" }));
    dashboardFetch(`/api/cron/run/${encodeURIComponent(taskId)}`, { method: "POST" })
      .then(r => { setRunningTasks(prev => ({ ...prev, [taskId]: r.ok ? "ok" : "error" })); clearSoon(taskId); })
      .catch(() => { setRunningTasks(prev => ({ ...prev, [taskId]: "error" })); clearSoon(taskId); });
  };

  const retryDeadLetter = (taskId: string) => {
    client?.send({ type: "retry_dead_letter", task_id: taskId });
  };

  return (
    <div>
      {/* Task table */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: "var(--text-faint)" }}>Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase" style={{ color: "var(--text-faint)" }}>Task</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase hidden md:table-cell" style={{ color: "var(--text-faint)" }}>Schedule</th>
              <th className="text-left px-4 py-3 text-xs font-medium uppercase hidden md:table-cell" style={{ color: "var(--text-faint)" }}>Last Run</th>
              <th className="text-right px-4 py-3 text-xs font-medium uppercase" style={{ color: "var(--text-faint)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cronManifest.tasks.map((task: any) => (
              <tr key={task.id} className="transition-colors" style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td className="px-4 py-3"><StatusBadge status={task.enabled ? getTaskStatus(task.id) : "disabled"} /></td>
                <td className="px-4 py-3">
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{task.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-faint)" }}>{task.description}</p>
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-sm" style={{ color: "var(--text-muted)" }}>{formatSchedule(task.schedule)}</td>
                <td className="px-4 py-3 hidden md:table-cell text-sm" style={{ color: "var(--text-faint)" }}>{getLastRun(task.id)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => triggerTask(task.id)}
                    disabled={runningTasks[task.id] === "running"}
                    className="px-3 py-1 text-xs rounded-md transition-colors"
                    style={{
                      background: "var(--bg-surface-hover)",
                      border: "1px solid var(--border-subtle)",
                      color: runningTasks[task.id] === "error" ? "var(--danger, #e5484d)" : "var(--text-secondary)",
                      opacity: runningTasks[task.id] === "running" ? 0.6 : 1,
                    }}
                  >{runningTasks[task.id] === "running" ? "Running…" : runningTasks[task.id] === "ok" ? "✓ Queued" : runningTasks[task.id] === "error" ? "✗ Failed" : "Run Now"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dead letter queue */}
      <div className="rounded-xl p-5 mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => setShowDeadLetters(!showDeadLetters)} className="flex items-center gap-2 w-full text-left">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>{showDeadLetters ? "▼" : "▶"}</span>
          <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Dead Letter Queue</h3>
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>({cronState.dead_letter_queue.length})</span>
        </button>
        {showDeadLetters && (
          cronState.dead_letter_queue.length === 0 ? (
            <div className="text-center py-6 text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              No dead letters — all systems healthy
            </div>
          ) : (
            <div className="space-y-3 mt-3">
              {cronState.dead_letter_queue.map((dl: any, i: number) => (
                <div key={i} className="rounded-lg p-4" style={{ background: "var(--danger-subtle)", border: "1px solid rgba(220, 38, 38, 0.2)" }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>{dl.task_id}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{dl.error}</p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>{relativeTime(dl.timestamp)} · {dl.attempts} attempts</p>
                    </div>
                    <button onClick={() => retryDeadLetter(dl.task_id)}
                      className="px-3 py-1 text-xs rounded-md"
                      style={{ background: "var(--bg-surface-hover)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
                    >Retry</button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Execution history */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-2 w-full text-left">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>{showHistory ? "▼" : "▶"}</span>
          <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Execution History</h3>
        </button>
        {showHistory && (
          <div className="mt-3">
            {cronState.execution_log.slice(-30).reverse().map((entry: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.timestamp?.slice(11, 16)}</span>
                <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{entry.task_id}</span>
                <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.duration_ms}ms</span>
                <StatusBadge status={entry.status} />
              </div>
            ))}
            {cronState.execution_log.length === 0 && (
              <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>No executions yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
