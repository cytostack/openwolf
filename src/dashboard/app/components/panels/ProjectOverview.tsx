import React from "react";
import { StatusBadge } from "../shared/StatusBadge.js";
import { StatTile } from "../shared/StatTile.js";
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
  const { health, tokenLedger, anatomy, buglog, cronState, config, statusDoc, scanState, project, identity } = data;
  const lt = tokenLedger.lifetime;
  const projectName = project.name || identity.name;
  const measured = (lt.real_api_calls ?? 0) > 0;
  const savingsPct = lt.total_tokens_estimated > 0
    ? Math.round((lt.estimated_savings_vs_bare_cli / (lt.total_tokens_estimated + lt.estimated_savings_vs_bare_cli)) * 100)
    : 0;
  const anatomyTotal = lt.anatomy_hits + lt.anatomy_misses;
  const hitRate = anatomyTotal > 0 ? Math.round((lt.anatomy_hits / anatomyTotal) * 100) : null;
  const scanAgeH = scanState.last_scanned
    ? Math.floor((Date.now() - new Date(scanState.last_scanned).getTime()) / 3600000)
    : null;
  const phase = nextPhase(statusDoc);

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
        {/* Hero — the inverted tile */}
        <div className="xl:col-span-2">
          <StatTile
            label="tokens saved · estimated"
            value={lt.estimated_savings_vs_bare_cli > 0 ? formatTokens(lt.estimated_savings_vs_bare_cli) : "0"}
            sub={savingsPct > 0 ? `${savingsPct}% vs bare agent` : "accumulates as sessions run"}
            variant="inverted"
            size="xl"
          />
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
        <StatTile label="sessions" value={fmt(lt.total_sessions)} size="md" />
        <StatTile label="files tracked" value={fmt(anatomy.metadata.files)} size="md" />
        <StatTile label="reads / writes" value={`${fmt(lt.total_reads)}·${fmt(lt.total_writes)}`} size="md" />
        <StatTile label="re-reads blocked" value={fmt(lt.repeated_reads_blocked)} size="md" />
        <StatTile label="anatomy hit rate" value={hitRate !== null ? `${hitRate}%` : "—"} size="md" />
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
              <span className="wd-label" style={{ color: "var(--accent)" }}>stale — run openwolf scan</span>
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
          </div>
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
