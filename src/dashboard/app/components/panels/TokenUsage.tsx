import React from "react";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { formatTokens } from "../../lib/utils.js";
import { StatTile } from "../shared/StatTile.js";
import { WdTable } from "../shared/WdTable.js";
import type { WolfData, LedgerSession } from "../../hooks/useWolfData.js";

function fmt(n: number | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

interface AgentRow {
  agent: string;
  sessions: number;
  estimated: number;
  realIn: number;
  realOut: number;
  cacheRead: number;
}

function byAgent(sessions: LedgerSession[]): AgentRow[] {
  const rows = new Map<string, AgentRow>();
  for (const s of sessions) {
    const agent = s.agent ?? "claude";
    const row = rows.get(agent) ?? { agent, sessions: 0, estimated: 0, realIn: 0, realOut: 0, cacheRead: 0 };
    row.sessions++;
    row.estimated += (s.totals?.input_tokens_estimated ?? 0) + (s.totals?.output_tokens_estimated ?? 0);
    if (s.real_usage) {
      row.realIn += s.real_usage.input_tokens;
      row.realOut += s.real_usage.output_tokens;
      row.cacheRead += s.real_usage.cache_read_input_tokens;
    }
    rows.set(agent, row);
  }
  return [...rows.values()].sort((a, b) => b.estimated - a.estimated);
}

export function TokenUsage({ data }: { data: WolfData }) {
  const { tokenLedger } = data;
  const lt = tokenLedger.lifetime;
  const measured = (lt.real_api_calls ?? 0) > 0;

  const chartData = tokenLedger.sessions.map((s) => ({
    date: s.started?.slice(5, 10) || "",
    input: s.totals?.input_tokens_estimated || 0,
    output: s.totals?.output_tokens_estimated || 0,
    measured: s.real_usage ? s.real_usage.input_tokens + s.real_usage.output_tokens : null,
  }));

  const agents = byAgent(tokenLedger.sessions);
  const savingsPct = lt.total_tokens_estimated > 0
    ? Math.round((lt.estimated_savings_vs_bare_cli / (lt.total_tokens_estimated + lt.estimated_savings_vs_bare_cli)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="estimated · lifetime" value={formatTokens(lt.total_tokens_estimated)} sub="char-ratio heuristic" size="md" />
        <StatTile
          label="measured · lifetime"
          value={measured ? formatTokens((lt.real_input_tokens ?? 0) + (lt.real_output_tokens ?? 0)) : "—"}
          sub={measured ? `${fmt(lt.real_api_calls)} api calls` : "fills in as sessions end"}
          size="md"
        />
        <StatTile
          label="cache read · measured"
          value={measured ? formatTokens(lt.real_cache_read_tokens ?? 0) : "—"}
          sub={measured ? "prompt cache working for you" : undefined}
          size="md"
        />
        <StatTile
          label="est. saved vs bare"
          value={lt.estimated_savings_vs_bare_cli > 0 ? formatTokens(lt.estimated_savings_vs_bare_cli) : "0"}
          sub={savingsPct > 0 ? `${savingsPct}% of would-be usage` : "approximate by design"}
          variant="inverted"
          size="md"
        />
      </div>

      {/* Usage over time */}
      <div className="wd-card p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="wd-label text-muted">usage over time · per session</span>
          <span className="wd-label text-faint">tokens</span>
        </div>
        {chartData.length === 0 ? (
          <div className="text-sm py-8 text-center text-muted">No session data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={{ stroke: "var(--chart-grid)" }} tickLine={false} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }} tickFormatter={(v) => formatTokens(v)} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "var(--chart-tooltip-bg)", border: "1px solid var(--chart-tooltip-border)", borderRadius: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 12 }}
                formatter={(v: number, name: string) => [formatTokens(v), name]}
              />
              <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }} />
              <Area isAnimationActive={false} type="monotone" dataKey="input" name="est. input" stackId="1" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.16} />
              <Area isAnimationActive={false} type="monotone" dataKey="output" name="est. output" stackId="1" stroke="var(--series-2)" strokeWidth={2} fill="var(--series-2)" fillOpacity={0.16} />
              {measured && (
                <Line isAnimationActive={false} type="monotone" dataKey="measured" name="measured" stroke="var(--series-red)" strokeWidth={2} dot={{ r: 3, fill: "var(--series-red)", strokeWidth: 0 }} connectNulls />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-agent breakdown */}
      <div className="wd-card p-5">
        <span className="wd-label text-muted">by agent</span>
        {agents.length === 0 ? (
          <p className="text-sm mt-3 text-muted">No sessions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <WdTable
              className="w-full text-sm font-mono"
              columns={[
                { key: "agent", label: "agent" },
                { key: "sessions", label: "sessions", align: "right", cellClassName: "text-secondary" },
                { key: "estimated", label: "estimated", align: "right", cellClassName: "text-secondary" },
                { key: "measuredIn", label: "measured in", align: "right", cellClassName: "text-secondary" },
                { key: "measuredOut", label: "measured out", align: "right", cellClassName: "text-secondary" },
                { key: "cacheRead", label: "cache read", align: "right", cellClassName: "text-secondary" },
              ]}
              rows={agents.map((row) => ({
                agent: <span className="text-primary">{row.agent}</span>,
                sessions: fmt(row.sessions),
                estimated: formatTokens(row.estimated),
                measuredIn: row.realIn > 0 ? formatTokens(row.realIn) : "—",
                measuredOut: row.realOut > 0 ? formatTokens(row.realOut) : "—",
                cacheRead: row.cacheRead > 0 ? formatTokens(row.cacheRead) : "—",
              }))}
            />
          </div>
        )}
        <p className="wd-label mt-3 text-faint">
          estimated = char-ratio heuristic · measured = summed from harness transcripts at session end
        </p>
      </div>

      {/* Waste alerts */}
      {tokenLedger.waste_flags.length > 0 && (
        <div className="wd-card p-5">
          <span className="wd-label text-muted">waste alerts</span>
          <div className="space-y-3 mt-3">
            {tokenLedger.waste_flags.map((flag: any, i: number) => (
              <div key={i} className="rounded-xl p-4 wd-danger-box">
                <div className="flex items-start gap-2.5">
                  <span className="rounded-full mt-1.5 wd-dot" style={{ width: 6, height: 6 }} />
                  <div>
                    <p className="text-sm font-medium text-primary">{flag.pattern}</p>
                    <p className="text-sm mt-1 text-muted">{flag.description}</p>
                    <p className="wd-label mt-2 text-faint">{flag.suggestion}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
