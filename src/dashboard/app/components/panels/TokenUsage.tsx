import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { formatTokens } from "../../lib/utils.js";
import type { WolfData } from "../../hooks/useWolfData.js";

export function TokenUsage({ data }: { data: WolfData }) {
  const { tokenLedger } = data;
  const lt = tokenLedger.lifetime;

  // Build chart data from sessions
  const chartData = tokenLedger.sessions.map((s: any) => ({
    date: s.started ? s.started.slice(0, 16).replace("T", " ") : "",
    input: s.totals?.input_tokens_estimated || 0,
    output: s.totals?.output_tokens_estimated || 0,
  }));

  // Comparison data — only real tracked numbers, no fabricated estimates
  const totalTracked = lt.total_tokens_estimated;
  const savings = lt.estimated_savings_vs_bare_cli;
  const withoutWolf = totalTracked + savings;
  const savingsPercent = withoutWolf > 0 ? Math.round((savings / withoutWolf) * 100) : 0;
  const hasComparisonData = savings > 0;

  const comparisonData = [
    { name: "Without OpenWolf (est.)", tokens: withoutWolf, fill: "#fbbf24" },
    { name: "With OpenWolf (actual)", tokens: totalTracked, fill: "#34d399" },
  ];

  return (
    <div>
      {/* Usage over time */}
      <div className="rounded-xl p-5 mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="font-medium mb-4" style={{ color: "var(--text-secondary)" }}>Usage Over Time</h3>
        {chartData.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>No session data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="date" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickFormatter={(v) => formatTokens(v)} />
              <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#e5e5e5" }} />
              <Area type="monotone" dataKey="input" name="Input (reads)" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              <Area type="monotone" dataKey="output" name="Output (writes)" stackId="1" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Comparison */}
      <div className="rounded-xl p-5 mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Token Comparison</h3>
          {savingsPercent > 0 && (
            <span className="px-3 py-1 rounded-full text-sm font-medium" style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}>
              OpenWolf saved ~{savingsPercent}%
            </span>
          )}
        </div>
        {!hasComparisonData ? (
          <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
            No savings data yet. Comparison will appear once OpenWolf has tracked repeated-read savings across sessions.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={comparisonData} layout="vertical">
                <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickFormatter={(v) => formatTokens(v)} />
                <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 12 }} width={220} />
                <Tooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#e5e5e5" }} cursor={{ fill: "transparent" }} formatter={(v: number) => [formatTokens(v) + " tokens", ""]} />
                <Bar dataKey="tokens" radius={[0, 4, 4, 0]} background={{ fill: "transparent" }}>
                  {comparisonData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs mt-3" style={{ color: "var(--text-faint)" }}>Based on repeated-read blocks tracked by OpenWolf across your sessions.</p>
          </>
        )}
      </div>

      {/* Waste alerts */}
      {tokenLedger.waste_flags.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Waste Alerts</h3>
          <div className="space-y-3">
            {tokenLedger.waste_flags.map((flag: any, i: number) => (
              <div key={i} className="rounded-lg p-4" style={{ background: "var(--warning-subtle)", border: "1px solid rgba(217, 119, 6, 0.2)" }}>
                <div className="flex items-start gap-2">
                  <span style={{ color: "var(--warning)" }} className="mt-0.5">⚠</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--warning)" }}>{flag.pattern}</p>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{flag.description}</p>
                    <p className="text-xs mt-2" style={{ color: "var(--text-faint)" }}>{flag.suggestion}</p>
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
