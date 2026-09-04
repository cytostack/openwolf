import React from "react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { StatTile } from "../shared/StatTile.js";
import { costOfProject, formatUsd } from "../../lib/pricing.js";
import type { ModelUsage } from "../../lib/pricing.js";
import { DotBar, type DotBarDatum } from "../shared/DotBar.js";
import { formatTokens } from "../../lib/utils.js";
import type { WolfData } from "../../hooks/useWolfData.js";

function fmt(n: number | undefined): string {
  return (n ?? 0).toLocaleString("en-US");
}

/** Sessions per weekday over the ledger's recent history → dot chart. */
function weeklyActivity(data: WolfData): DotBarDatum[] {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = new Array(7).fill(0);
  for (const s of data.tokenLedger.sessions.slice(-60)) {
    const d = new Date(s.ended ?? s.started);
    if (!isNaN(d.getTime())) counts[(d.getDay() + 6) % 7]++;
  }
  const today = (new Date().getDay() + 6) % 7;
  return days.map((label, i) => ({ label, value: counts[i], highlight: i === today }));
}

/**
 * Extract the "Next phase" section from STATUS.md for the handoff card.
 * Unfilled template placeholders (`_<...>_`) are dropped; markdown emphasis
 * is stripped for plain rendering.
 */
function nextPhase(statusDoc: string): string[] {
  const lines = statusDoc.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## 🚀/.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && out.length < 5; i++) {
    if (/^## |^---\s*$/.test(lines[i])) break;
    let t = lines[i].trim();
    if (!t) continue;
    if (/<[^>]*>/.test(t)) continue;   // unfilled template placeholder
    if (t.startsWith("|")) continue;   // markdown table markup
    t = t.replace(/^#+\s*/, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/_([^_]+)_/g, "$1");
    if (t) out.push(t);
  }
  // Only headings survived → the section is still the empty template.
  const meaningful = out.some((l) => !/^(Acceptance criteria|Files to create \/ edit|Open decisions|Closed decisions)$/i.test(l));
  return meaningful ? out : [];
}

export function ProjectOverview({ data }: { data: WolfData }) {
  const { health, tokenLedger, anatomy, buglog, cronState, config, contextHealth, hookHealth, statusDoc, scanState, project, identity } = data;
  const brokenHooks = Object.entries(hookHealth).filter(([, h]) => h.consecutive_failures >= 2);
  const hookCount = Object.keys(hookHealth).length;
  const lt = tokenLedger.lifetime;
  const projectName = project.name || identity.name;
  const measured = (lt.real_api_calls ?? 0) > 0;
  const dupMode = config.reads?.duplicate_mode ?? "warn";
  const denyOn = dupMode === "deny";
  const anatomyTotal = lt.anatomy_hits + lt.anatomy_misses;
  const hitRate = anatomyTotal > 0 ? Math.round((lt.anatomy_hits / anatomyTotal) * 100) : null;
  const scanAgeH = scanState.last_scanned
    ? Math.floor((Date.now() - new Date(scanState.last_scanned).getTime()) / 3600000)
    : null;
  const phase = nextPhase(statusDoc);

  // What this project's measured usage is worth at list price. Prefer the
  // daemon's whole-project scan; the per-session rollup is there from day one.
  const perModel = (tokenLedger.measured_project?.by_model ??
    tokenLedger.lifetime_maps?.real_by_model) as Record<string, ModelUsage> | undefined;
  const cost = costOfProject(perModel);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="dot-display text-4xl" style={{ color: "var(--text-primary)" }}>{projectName}</h2>
          <p className="wd-label mt-2" style={{ color: "var(--text-muted)" }}>
            one brain · {config.agents.length} agent{config.agents.length === 1 ? "" : "s"} wired
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={health.status} />
          {health.uptime_seconds > 0 && (
            <span className="wd-label" style={{ color: "var(--text-faint)" }}>
              up {Math.floor(health.uptime_seconds / 3600)}h {Math.floor((health.uptime_seconds % 3600) / 60)}m
            </span>
          )}
        </div>
      </div>

      {/* Bento: hero + measured + agents */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Hero — tokens verifiably kept out of context. The governor delta is
            measured at the rewrite point (original vs entered), which nothing
            else in the ecosystem can observe. */}
        <div className="xl:col-span-2">
          {(() => {
            const governedSaved = Math.max(0, (lt.bash_governed_original_tokens ?? 0) - (lt.bash_governed_entered_tokens ?? 0));
            const totalSaved = governedSaved + (denyOn ? lt.estimated_savings_vs_bare_cli : 0);
            if (totalSaved > 0) {
              const parts = [
                governedSaved > 0 ? `${formatTokens(governedSaved)} bash output governed (${fmt(lt.bash_governed_calls)} calls)` : "",
                denyOn && lt.estimated_savings_vs_bare_cli > 0 ? `${formatTokens(lt.estimated_savings_vs_bare_cli)} denied re-reads` : "",
              ].filter(Boolean).join(" · ");
              // The hero number is meaningless to anyone not reading a ledger
              // unless it says what it means. One sentence, plain words, and
              // the denominator so the figure can be sized.
              const governedOriginal = lt.bash_governed_original_tokens ?? 0;
              const sharePct = governedOriginal > 0 ? Math.round((governedSaved / governedOriginal) * 100) : null;
              return (
                <StatTile
                  label="tokens kept out of context · measured"
                  value={formatTokens(totalSaved)}
                  sub={parts || "measured at the rewrite point"}
                  variant="inverted"
                  size="xl"
                >
                  <p className="text-sm mt-4 leading-relaxed"
                    style={{ color: "color-mix(in srgb, var(--invert-text) 70%, transparent)" }}>
                    Text your agent never had to carry, and never had to pay for again on every
                    later message.
                    {sharePct !== null && ` That is ${sharePct}% of ${formatTokens(governedOriginal)} of command output.`}
                    {" "}The full text is still on disk.
                  </p>
                </StatTile>
              );
            }
            return (
              <StatTile
                label="tokens kept out of context · measured"
                value="0"
                sub={`accumulates as the bash governor condenses oversized output${denyOn ? "" : " · deny mode off (reads.duplicate_mode)"}`}
                variant="inverted"
                size="xl"
              />
            );
          })()}
        </div>

        {/* Measured usage */}
        <div className="wd-card p-5 flex flex-col justify-between gap-3 min-h-[132px]">
          <div className="flex items-start justify-between">
            <span className="wd-label" style={{ color: "var(--text-muted)" }}>measured · transcripts</span>
            {measured && <span className="rounded-full" style={{ width: 6, height: 6, background: "var(--accent)" }} />}
          </div>
          {measured ? (
            <div className="space-y-1.5 font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
              <div className="flex justify-between"><span>in</span><span className="dot-display text-base" style={{ color: "var(--text-primary)" }}>{fmt(lt.real_input_tokens)}</span></div>
              <div className="flex justify-between"><span>out</span><span className="dot-display text-base" style={{ color: "var(--text-primary)" }}>{fmt(lt.real_output_tokens)}</span></div>
              <div className="flex justify-between"><span>cache read</span><span className="dot-display text-base" style={{ color: "var(--text-primary)" }}>{fmt(lt.real_cache_read_tokens)}</span></div>
              <div className="flex justify-between wd-label pt-1" style={{ color: "var(--text-faint)" }}><span>api calls</span><span>{fmt(lt.real_api_calls)}</span></div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No measured usage yet — real token counts are read from each session's transcript at Stop.
            </p>
          )}
        </div>

        {/* Agents */}
        <div className="wd-card p-5 flex flex-col justify-between gap-3 min-h-[132px]">
          <span className="wd-label" style={{ color: "var(--text-muted)" }}>agents</span>
          <div className="flex flex-wrap gap-2">
            {config.agents.map((a) => (
              <span key={a} className="flex flex-col items-center gap-1.5">
                <span className="dot-display flex items-center justify-center rounded-full text-sm"
                  style={{ width: 44, height: 44, border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  {a.slice(0, 2).toUpperCase()}
                </span>
                <span className="wd-label" style={{ color: "var(--text-faint)", fontSize: "0.55rem" }}>{a}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <StatTile
          label="usage worth · list price"
          value={cost.priced ? formatUsd(cost.total) : "—"}
          sub={cost.priced ? `${fmt(lt.real_api_calls)} api calls` : "fills in as sessions end"}
          size="md"
        />
        <StatTile label="files tracked" value={fmt(anatomy.metadata.files)} size="md" />
        {/* Reads and writes glued with a dot said nothing. The ratio is the
            signal: an agent writing far more than it reads is working from the
            index instead of re-reading the tree, which is the point. */}
        <StatTile
          label="edits per file read"
          value={lt.total_reads > 0 ? `${(lt.total_writes / lt.total_reads).toFixed(1)}x` : fmt(lt.total_writes)}
          sub={`${fmt(lt.total_writes)} edits · ${fmt(lt.total_reads)} reads`}
          size="md"
        />
        {denyOn ? (
          <StatTile label="re-reads denied" value={fmt(lt.repeated_reads_blocked)} size="md" />
        ) : (
          <StatTile
            label="re-read warnings"
            value={fmt(lt.repeated_reads_warned)}
            sub={(lt.repeated_reads_warned ?? 0) > 0 ? "warned, not blocked" : undefined}
            size="md"
          />
        )}
        {/* A low hit rate means the agent is reading files the index cannot
            describe, which is the single most actionable number here. */}
        <StatTile
          label="anatomy hit rate"
          value={hitRate !== null ? `${hitRate}%` : "—"}
          accent={hitRate !== null && hitRate < 30}
          sub={hitRate !== null && hitRate < 30 ? "low · agent is not using openwolf find" : undefined}
          size="md"
        />
        <StatTile
          label="bugs on file"
          value={fmt(buglog.bugs.length)}
          size="md"
          accent={cronState.dead_letter_queue.length > 0}
          sub={cronState.dead_letter_queue.length > 0 ? `${cronState.dead_letter_queue.length} dead-lettered task(s)` : undefined}
        />
      </div>

      {/* Context health + next phase */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="wd-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="wd-label" style={{ color: "var(--text-muted)" }}>context health</span>
            {scanAgeH !== null && scanAgeH > 6 && (
              <span className="wd-label" style={{ color: "var(--accent)" }}>stale · run openwolf scan</span>
            )}
          </div>
          <div className="space-y-2 font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
            <div className="flex justify-between">
              <span>anatomy scanned</span>
              <span>{scanAgeH === null ? "no scan state" : scanAgeH === 0 ? "under 1h ago" : `${scanAgeH}h ago`}</span>
            </div>
            <div className="flex justify-between">
              <span>git head pinned</span>
              <span>{scanState.git_head ? scanState.git_head.slice(0, 7) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>session digest budget</span>
              <span>{config.context?.session_digest_budget_tokens ?? 1500} tok</span>
            </div>
            <div className="flex justify-between">
              <span>duplicate read mode</span>
              <span>{dupMode}</span>
            </div>
            <div className="flex justify-between">
              <span>hook health</span>
              <span style={brokenHooks.length > 0 ? { color: "var(--accent)" } : undefined}>
                {hookCount === 0 ? "no heartbeats yet" : brokenHooks.length > 0 ? `${brokenHooks.length} failing` : `${hookCount} healthy`}
              </span>
            </div>
            {contextHealth && (
              <div className="flex justify-between">
                <span>always-on context (est.)</span>
                <span>{contextHealth.always_on_estimate_tokens.toLocaleString("en-US")} tok</span>
              </div>
            )}
          </div>
          {brokenHooks.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {brokenHooks.slice(0, 3).map(([name, h]) => (
                <p key={name} className="text-sm" style={{ color: "var(--accent)" }}>
                  {name}: {h.consecutive_failures} consecutive failures. Run openwolf update to repair. {h.last_error_message ? `(${h.last_error_message.slice(0, 80)})` : ""}
                </p>
              ))}
            </div>
          )}
          {contextHealth && contextHealth.findings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {contextHealth.findings.map((f) => (
                <p key={f.id} className="text-sm" style={{ color: f.severity === "warn" ? "var(--accent)" : "var(--text-muted)" }}>
                  {f.message}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="wd-card p-5">
          <span className="wd-label" style={{ color: "var(--text-muted)" }}>next phase · status.md</span>
          {phase.length > 0 ? (
            <div className="mt-3 space-y-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              {phase.map((line, i) => (
                <p key={i} className={i === 0 ? "font-medium" : ""} style={i === 0 ? { color: "var(--text-primary)" } : undefined}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              No handoff yet — .wolf/STATUS.md fills in as work completes.
            </p>
          )}
        </div>
      </div>

      {/* Weekly activity dot chart */}
      <div className="wd-card p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="wd-label" style={{ color: "var(--text-muted)" }}>sessions / week</span>
          <span className="wd-label" style={{ color: "var(--text-faint)" }}>last {Math.min(tokenLedger.sessions.length, 60)} sessions</span>
        </div>
        {tokenLedger.sessions.length > 0 ? (
          <DotBar data={weeklyActivity(data)} rows={7} unit="sessions" />
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No sessions yet — start your agent and this fills in live.</p>
        )}
      </div>
    </div>
  );
}
