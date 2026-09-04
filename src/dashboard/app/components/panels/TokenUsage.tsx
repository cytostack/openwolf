import React from "react";
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart } from "recharts";
import { formatTokens } from "../../lib/utils.js";
import { StatTile } from "../shared/StatTile.js";
import { costOfProject, formatUsd, CACHE_READ_MULTIPLIER } from "../../lib/pricing.js";
import type { ModelUsage } from "../../lib/pricing.js";
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
  const { tokenLedger, config } = data;
  const lt = tokenLedger.lifetime;
  const measured = (lt.real_api_calls ?? 0) > 0;
  const dupMode = config.reads?.duplicate_mode ?? "warn";
  const denyOn = dupMode === "deny";

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

  // Cost. Prefer the daemon's project-wide transcript scan (it sees subagents
  // and every transcript); fall back to the lifetime per-model rollup the Stop
  // hook maintains, which is present from the very first session.
  const perModel = (tokenLedger.measured_project?.by_model ??
    tokenLedger.lifetime_maps?.real_by_model) as Record<string, ModelUsage> | undefined;
  const cost = costOfProject(perModel);
  const costSource = tokenLedger.measured_project?.by_model ? "all transcripts" : "session ledger";

  // What the governor kept out, and what OpenWolf charged for keeping it out.
  const governedOriginal = lt.bash_governed_original_tokens ?? 0;
  const governedEntered = lt.bash_governed_entered_tokens ?? 0;
  const keptOut = Math.max(0, governedOriginal - governedEntered) + (lt.estimated_savings_vs_bare_cli ?? 0);
  const overhead = lt.injection_tokens_estimated ?? 0;
  const overheadPct = keptOut > 0 ? (overhead / keptOut) * 100 : null;
  // One rendering of this number, or the tile and the paragraph disagree
  // (1.6% vs 2%) about the same fraction on the same screen.
  const overheadLabel =
    overheadPct === null ? null : overheadPct < 0.1 ? "<0.1%" : overheadPct < 10 ? `${overheadPct.toFixed(1)}%` : `${Math.round(overheadPct)}%`;
  const netKeptOut = keptOut - overhead;

  // Governor breakdown by command family, worst-value families last.
  const families = Object.entries(tokenLedger.lifetime_maps?.bash_governed_by_family ?? {})
    .map(([family, f]) => {
      const kept = Math.max(0, (f.original_tokens ?? 0) - (f.entered_tokens ?? 0));
      return {
        family,
        calls: f.calls ?? 0,
        original: f.original_tokens ?? 0,
        entered: f.entered_tokens ?? 0,
        kept,
        pct: f.original_tokens > 0 ? (kept / f.original_tokens) * 100 : 0,
      };
    })
    .filter((f) => f.calls > 0)
    .sort((a, b) => b.kept - a.kept);
  const familyMaxKept = Math.max(1, ...families.map((f) => f.kept));

  // A cache read is roughly a tenth of an input token, so the tokens the
  // governor kept out are worth that much on every call that followed. Priced
  // at the blended input rate actually observed on this project.
  const blendedInputPerMTok = cost.priced && cost.byModel.length > 0
    ? cost.byModel.reduce((sum, r) => sum + r.cost.cacheRead, 0) /
      Math.max(1, cost.byModel.reduce((sum, r) => sum + (r.usage.cache_read_input_tokens ?? 0), 0)) * 1_000_000 /
      CACHE_READ_MULTIPLIER
    : null;

  return (
    <div className="space-y-4">
      {/* Headline tiles — measured numbers lead, estimates are demoted */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          label="openwolf overhead"
          value={overheadLabel ?? formatTokens(overhead)}
          sub={
            overheadLabel !== null
              ? `${formatTokens(overhead)} injected · ${overheadLabel} of what it kept out`
              : "context injected by hooks"
          }
          size="md"
        />
        <StatTile
          label="what this usage is worth"
          value={cost.priced ? formatUsd(cost.total) : "—"}
          sub={cost.priced ? `at list price · ${costSource}` : "fills in as sessions end"}
          variant="inverted"
          size="md"
        />
      </div>

      {/* Where the money went. Cache reads dominate on every real project and
          nobody expects it, so the breakdown is a bar, not a table row. */}
      {cost.priced && (
        <div className="wd-card p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="wd-label" style={{ color: "var(--text-muted)" }}>where the cost is</span>
            <span className="wd-label" style={{ color: "var(--text-faint)" }}>list price · {costSource}</span>
          </div>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            What this project's measured token usage is worth at Anthropic's published rates.
            On a Claude subscription you are not billed per token, so read this as the size of
            the work, not an invoice.
          </p>

          <div className="flex h-3 rounded-full overflow-hidden mb-3" style={{ background: "var(--bg-surface-hover)" }}>
            {([
              ["cache read", cost.cacheRead, "var(--text-primary)"],
              ["output", cost.output, "var(--accent)"],
              ["cache write", cost.cacheWrite, "var(--text-muted)"],
              ["fresh input", cost.input, "var(--text-faint)"],
            ] as Array<[string, number, string]>).map(([label, amount, color]) => (
              amount > 0 ? (
                <div key={label} title={`${label}: ${formatUsd(amount)}`}
                  style={{ width: `${(amount / cost.total) * 100}%`, background: color }} />
              ) : null
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm mb-4">
            {([
              ["cache read", cost.cacheRead],
              ["output", cost.output],
              ["cache write", cost.cacheWrite],
              ["fresh input", cost.input],
            ] as Array<[string, number]>).map(([label, amount]) => (
              <div key={label}>
                <div className="wd-label" style={{ color: "var(--text-faint)" }}>{label}</div>
                <div className="dot-display text-xl" style={{ color: "var(--text-primary)" }}>{formatUsd(amount)}</div>
                <div className="wd-label" style={{ color: "var(--text-faint)" }}>
                  {cost.total > 0 ? `${Math.round((amount / cost.total) * 100)}%` : "0%"}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5 font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            {cost.byModel.map((row) => (
              <div key={row.model} className="flex justify-between gap-4">
                <span className="truncate">{row.model}</span>
                <span style={{ color: "var(--text-faint)" }}>
                  {fmt(row.usage.api_calls)} calls · {formatTokens(row.usage.cache_read_input_tokens)} cache read
                </span>
                <span className="dot-display" style={{ color: "var(--text-primary)" }}>{formatUsd(row.cost.total)}</span>
              </div>
            ))}
          </div>
          {cost.unpriced.length > 0 && (
            <p className="wd-label mt-3" style={{ color: "var(--text-faint)" }}>
              not priced (unknown model, excluded from the total): {cost.unpriced.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Plain language, for the many OpenWolf users who are not reading a
          ledger. One paragraph, real numbers, no jargon. */}
      <div className="wd-card p-5">
        <span className="wd-label" style={{ color: "var(--text-muted)" }}>in plain language</span>
        {keptOut > 0 ? (
          <div className="mt-3 space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            <p>
              OpenWolf kept{" "}
              <span className="dot-display text-xl" style={{ color: "var(--text-primary)" }}>{formatTokens(keptOut)}</span>{" "}
              tokens out of your agent's context. That is text your agent would otherwise have
              carried in every message for the rest of the session, paid for again on each one.
              {blendedInputPerMTok !== null && (
                <> Had all of it sat in context for this project's{" "}
                {fmt(Math.max(1, lt.real_api_calls ?? 1))} calls, that would have been up to{" "}
                <span style={{ color: "var(--text-primary)" }}>
                  {formatUsd((keptOut * (lt.real_api_calls ?? 1) * blendedInputPerMTok * CACHE_READ_MULTIPLIER) / 1_000_000)}
                </span>{" "}
                in cache reads. A ceiling, not a measurement: output arrives throughout a
                session, so the real figure is lower.</>
              )}
            </p>
            <p>
              Doing that cost {formatTokens(overhead)} tokens of its own, so the net saving is{" "}
              <span style={{ color: "var(--text-primary)" }}>{formatTokens(Math.max(0, netKeptOut))}</span>
              {overheadLabel !== null && <> ({overheadLabel} overhead)</>}.
              Nothing was lost: every condensed output is still on disk, and the agent is told where.
            </p>
            {!denyOn && (lt.repeated_reads_warned ?? 0) > 0 && (
              <p style={{ color: "var(--text-muted)" }}>
                Separately, {fmt(lt.repeated_reads_warned)} repeated file{" "}
                {(lt.repeated_reads_warned ?? 0) === 1 ? "read was" : "reads were"} flagged but allowed,
                because duplicate reads are set to <span className="font-mono">{dupMode}</span>. Set
                <span className="font-mono"> openwolf.reads.duplicate_mode</span> to
                <span className="font-mono"> deny</span> to block them and count the saving here.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing kept out yet. This fills in the first time a command produces more output than
            the governor threshold, or a file is read twice.
          </p>
        )}
      </div>

      {/* Which command families the governor is actually earning its keep on */}
      {families.length > 0 && (
        <div className="wd-card p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="wd-label" style={{ color: "var(--text-muted)" }}>governor · by command family</span>
            <span className="wd-label" style={{ color: "var(--text-faint)" }}>
              {fmt(lt.bash_governed_calls)} governed calls
            </span>
          </div>
          <div className="space-y-3">
            {families.map((f) => (
              <div key={f.family} className="flex items-center gap-3 font-mono text-sm">
                <span className="w-28 shrink-0 truncate" style={{ color: "var(--text-secondary)" }}>
                  {f.family.replace(/_/g, " ")}
                </span>
                <span className="w-10 shrink-0 text-right" style={{ color: "var(--text-faint)" }}>{f.calls}x</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-surface-hover)" }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${(f.kept / familyMaxKept) * 100}%`, background: f.pct >= 50 ? "var(--accent)" : "var(--text-muted)" }} />
                </div>
                <span className="w-24 shrink-0 text-right dot-display" style={{ color: "var(--text-primary)" }}>
                  {formatTokens(f.kept)}
                </span>
                <span className="w-12 shrink-0 text-right" style={{ color: "var(--text-faint)" }}>
                  {Math.round(f.pct)}%
                </span>
              </div>
            ))}
          </div>
          <p className="wd-label mt-4" style={{ color: "var(--text-faint)" }}>
            tokens kept out per family · percentage of that family's output condensed.
            A family sitting near 0% is set to suggest, or its output rarely crosses the threshold.
          </p>
        </div>
      )}

      {/* Project-wide ground truth: every transcript, incl. subagents */}
      {tokenLedger.measured_project && (
        <div className="wd-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="wd-label" style={{ color: "var(--text-muted)" }}>measured · all project transcripts</span>
            <span className="wd-label" style={{ color: "var(--text-faint)" }}>
              {tokenLedger.measured_project.transcripts} transcripts · scanned {tokenLedger.measured_project.scanned_at?.slice(0, 16).replace("T", " ")}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            <div className="flex justify-between"><span>in</span><span className="dot-display" style={{ color: "var(--text-primary)" }}>{formatTokens(tokenLedger.measured_project.input_tokens)}</span></div>
            <div className="flex justify-between"><span>out</span><span className="dot-display" style={{ color: "var(--text-primary)" }}>{formatTokens(tokenLedger.measured_project.output_tokens)}</span></div>
            <div className="flex justify-between"><span>cache read</span><span className="dot-display" style={{ color: "var(--text-primary)" }}>{formatTokens(tokenLedger.measured_project.cache_read_input_tokens)}</span></div>
            <div className="flex justify-between"><span>cache write</span><span className="dot-display" style={{ color: "var(--text-primary)" }}>{formatTokens(tokenLedger.measured_project.cache_creation_input_tokens)}</span></div>
          </div>
          {Object.keys(tokenLedger.measured_project.by_model).length > 0 && (
            <div className="mt-3 space-y-1 font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
              {Object.entries(tokenLedger.measured_project.by_model)
                .sort((a, b) => b[1].output_tokens - a[1].output_tokens)
                .map(([model, m]) => (
                  <div key={model} className="flex justify-between">
                    <span style={{ color: "var(--text-muted)" }}>{model}</span>
                    <span>in {formatTokens(m.input_tokens)} · out {formatTokens(m.output_tokens)} · {fmt(m.api_calls)} calls</span>
                  </div>
                ))}
              {tokenLedger.measured_project.sidechain.api_calls > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-muted)" }}>subagent share</span>
                  <span>in {formatTokens(tokenLedger.measured_project.sidechain.input_tokens)} · out {formatTokens(tokenLedger.measured_project.sidechain.output_tokens)} · {fmt(tokenLedger.measured_project.sidechain.api_calls)} calls</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Usage over time */}
      <div className="wd-card p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="wd-label" style={{ color: "var(--text-muted)" }}>usage over time · per session</span>
          <span className="wd-label" style={{ color: "var(--text-faint)" }}>tokens</span>
        </div>
        {chartData.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "var(--text-muted)" }}>No session data yet.</div>
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
        <span className="wd-label" style={{ color: "var(--text-muted)" }}>by agent</span>
        {agents.length === 0 ? (
          <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>No sessions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="wd-label" style={{ color: "var(--text-faint)" }}>
                  <th className="text-left py-2 font-normal">agent</th>
                  <th className="text-right py-2 font-normal">sessions</th>
                  <th className="text-right py-2 font-normal">estimated</th>
                  <th className="text-right py-2 font-normal">measured in</th>
                  <th className="text-right py-2 font-normal">measured out</th>
                  <th className="text-right py-2 font-normal">cache read</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((row) => (
                  <tr key={row.agent} style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                    <td className="py-2.5" style={{ color: "var(--text-primary)" }}>{row.agent}</td>
                    <td className="text-right py-2.5">{fmt(row.sessions)}</td>
                    <td className="text-right py-2.5">{formatTokens(row.estimated)}</td>
                    <td className="text-right py-2.5">{row.realIn > 0 ? formatTokens(row.realIn) : "—"}</td>
                    <td className="text-right py-2.5">{row.realOut > 0 ? formatTokens(row.realOut) : "—"}</td>
                    <td className="text-right py-2.5">{row.cacheRead > 0 ? formatTokens(row.cacheRead) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="wd-label mt-3" style={{ color: "var(--text-faint)" }}>
          estimated = char-ratio heuristic · measured = summed from harness transcripts at session end
        </p>
        {(() => {
          const withVerified = tokenLedger.sessions.filter((s) => s.verified);
          if (withVerified.length === 0) return null;
          const fired = withVerified.reduce((n, s) => n + (s.verified!.hooks_fired ?? 0), 0);
          const failed = withVerified.reduce((n, s) => n + (s.verified!.hooks_failed ?? 0), 0);
          const delivered = withVerified.reduce((n, s) => n + (s.verified!.injections_delivered ?? 0), 0);
          const deliveredTok = withVerified.reduce((n, s) => n + (s.verified!.injection_tokens_delivered ?? 0), 0);
          return (
            <p className="wd-label mt-1" style={{ color: failed > 0 ? "var(--accent)" : "var(--text-faint)" }}>
              verified from transcripts ({withVerified.length} sessions): {fmt(fired)} hook runs · {fmt(failed)} failures · {fmt(delivered)} injections ({formatTokens(deliveredTok)}) actually entered context
            </p>
          );
        })()}
      </div>

      {/* Waste alerts */}
      {tokenLedger.waste_flags.length > 0 && (
        <div className="wd-card p-5">
          <span className="wd-label" style={{ color: "var(--text-muted)" }}>waste alerts</span>
          <div className="space-y-3 mt-3">
            {tokenLedger.waste_flags.map((flag: any, i: number) => (
              <div key={i} className="rounded-xl p-4" style={{ background: "var(--danger-subtle)", border: "1px solid var(--border)" }}>
                <div className="flex items-start gap-2.5">
                  <span className="rounded-full mt-1.5" style={{ width: 6, height: 6, background: "var(--accent)", flexShrink: 0 }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{flag.pattern}</p>
                    <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{flag.description}</p>
                    <p className="wd-label mt-2" style={{ color: "var(--text-faint)" }}>{flag.suggestion}</p>
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
