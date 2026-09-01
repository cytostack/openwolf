import React, { useState } from "react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { CollapseCard } from "../shared/CollapseCard.js";
import { WdTable } from "../shared/WdTable.js";
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
      <div className="wd-card overflow-x-auto mb-6">
        <WdTable
          cellClassName="px-4 py-3"
          columns={[
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            {
              key: "task",
              label: "Task",
              render: (row) => (
                <>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{row.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-faint)" }}>{row.description}</p>
                </>
              ),
            },
            { key: "schedule", label: "Schedule", className: "hidden md:table-cell", render: (row) => <span className="text-sm" style={{ color: "var(--text-muted)" }}>{row.schedule}</span> },
            { key: "lastRun", label: "Last Run", className: "hidden md:table-cell", render: (row) => <span className="text-sm" style={{ color: "var(--text-faint)" }}>{row.lastRun}</span> },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (row) => (
                <button
                  onClick={() => triggerTask(row.id)}
                  disabled={runningTasks[row.id] === "running"}
                  className="px-3 py-1 text-xs rounded-md transition-colors"
                  style={{
                    background: "var(--bg-surface-hover)",
                    border: "1px solid var(--border-subtle)",
                    color: runningTasks[row.id] === "error" ? "var(--danger)" : "var(--text-secondary)",
                    opacity: runningTasks[row.id] === "running" ? 0.6 : 1,
                  }}
                >{runningTasks[row.id] === "running" ? "Running…" : runningTasks[row.id] === "ok" ? "Queued" : runningTasks[row.id] === "error" ? "Failed" : "Run Now"}</button>
              ),
            },
          ]}
          rows={cronManifest.tasks.map((task: any) => ({
            id: task.id,
            status: task.enabled ? getTaskStatus(task.id) : "disabled",
            name: task.name,
            description: task.description,
            schedule: formatSchedule(task.schedule),
            lastRun: getLastRun(task.id),
          }))}
        />
      </div>

      {/* Dead letter queue */}
      <div className="mb-6">
        <CollapseCard
          expanded={showDeadLetters}
          onToggle={() => setShowDeadLetters(!showDeadLetters)}
          header={
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>{showDeadLetters ? "▼" : "▶"}</span>
              <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Dead Letter Queue</h3>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>({cronState.dead_letter_queue.length})</span>
            </div>
          }
        >
          {cronState.dead_letter_queue.length === 0 ? (
            <div className="px-5 pb-4 pt-4 text-sm" style={{ color: "var(--text-muted)" }}>
              No dead letters — all systems healthy
            </div>
          ) : (
            <div className="px-5 pb-4 pt-3 space-y-3">
              {cronState.dead_letter_queue.map((dl: any, i: number) => (
                <div key={i} className="rounded-lg p-4" style={{ background: "var(--danger-subtle)", border: "1px solid color-mix(in srgb, var(--danger) 20%, transparent)" }}>
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
          )}
        </CollapseCard>
      </div>

      {/* Execution history */}
      <CollapseCard
        expanded={showHistory}
        onToggle={() => setShowHistory(!showHistory)}
        header={
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>{showHistory ? "▼" : "▶"}</span>
            <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Execution History</h3>
          </div>
        }
      >
        {cronState.execution_log.length === 0 ? (
          <p className="px-5 py-4 text-sm text-center" style={{ color: "var(--text-muted)" }}>No executions yet.</p>
        ) : (
          <div className="px-5 py-3">
            {cronState.execution_log.slice(-30).reverse().map((entry: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.timestamp?.slice(11, 16)}</span>
                <span className="text-sm flex-1" style={{ color: "var(--text-secondary)" }}>{entry.task_id}</span>
                <span className="text-xs font-mono" style={{ color: "var(--text-faint)" }}>{entry.duration_ms}ms</span>
                <StatusBadge status={entry.status} />
              </div>
            ))}
          </div>
        )}
      </CollapseCard>
    </div>
  );
}
