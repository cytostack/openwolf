import { useState, useEffect, useCallback, useRef } from "react";
import { dashboardFetch, WolfClient } from "../lib/wolf-client.js";
import { parseAnatomy, parseMemory, parseCerebrum } from "../lib/file-parsers.js";
import type { AnatomyEntry, MemorySession, CerebrumData } from "../lib/file-parsers.js";

export interface RealUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

export interface LedgerSession {
  id: string;
  agent?: string;
  started: string;
  ended: string;
  totals: {
    input_tokens_estimated: number;
    output_tokens_estimated: number;
    reads_count: number;
    writes_count: number;
    repeated_reads_blocked: number;
    anatomy_lookups: number;
  };
  real_usage?: RealUsage;
  /** Transcript-verified hook activity; absent = estimates only. */
  verified?: {
    hooks_fired: number;
    hooks_failed: number;
    injections_delivered: number;
    injection_tokens_delivered: number;
  };
}

interface TokenLedger {
  lifetime: {
    total_tokens_estimated: number;
    total_reads: number;
    total_writes: number;
    total_sessions: number;
    anatomy_hits: number;
    anatomy_misses: number;
    repeated_reads_blocked: number;
    repeated_reads_warned?: number;
    estimated_savings_vs_bare_cli: number;
    injection_tokens_estimated?: number;
    bash_governed_calls?: number;
    bash_governed_original_tokens?: number;
    bash_governed_entered_tokens?: number;
    real_input_tokens?: number;
    real_output_tokens?: number;
    real_cache_read_tokens?: number;
    real_cache_creation_tokens?: number;
    real_api_calls?: number;
  };
  /** Lifetime per-key rollups (2.5): governor deltas per command family and
   * measured usage per model. Both survive session trimming. */
  lifetime_maps?: {
    bash_governed_by_family?: Record<string, { calls: number; original_tokens: number; entered_tokens: number }>;
    real_by_model?: Record<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; api_calls: number }>;
  };
  sessions: LedgerSession[];
  waste_flags: any[];
  /** Project-wide transcript scan written by the daemon (J1 ground truth). */
  measured_project?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    api_calls: number;
    transcripts: number;
    by_model: Record<string, { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; api_calls: number }>;
    sidechain: { input_tokens: number; output_tokens: number; api_calls: number };
    last_activity: string | null;
    scanned_at: string;
  };
}

export interface WolfConfig {
  agents: string[];
  context?: { session_digest_budget_tokens?: number; budgets?: Record<string, number> };
  reads?: { duplicate_mode?: string };
}

export type HookHealth = Record<string, {
  last_ok?: string;
  last_error?: string;
  last_error_message?: string;
  consecutive_failures: number;
}>;

export interface ContextHealth {
  findings: Array<{ id: string; severity: "info" | "warn"; message: string }>;
  always_on_estimate_tokens: number;
  generated_at: string;
}

export interface ScanState {
  last_scanned?: string;
  git_head?: string | null;
  file_count?: number;
}

interface CronState {
  engine_status: string;
  last_heartbeat: string | null;
  execution_log: any[];
  dead_letter_queue: any[];
}

interface BugLog {
  bugs: any[];
}

interface CronManifest {
  tasks: any[];
}

interface Health {
  status: string;
  uptime_seconds: number;
}

interface ProjectMeta {
  name: string;
  description: string;
  root: string;
}

export interface WolfData {
  anatomy: { entries: AnatomyEntry[]; metadata: { files: number; hits: number; misses: number } };
  cerebrum: CerebrumData;
  memory: MemorySession[];
  tokenLedger: TokenLedger;
  cronState: CronState;
  cronManifest: CronManifest;
  buglog: BugLog;
  health: Health;
  identity: { name: string; role: string };
  project: ProjectMeta;
  config: WolfConfig;
  contextHealth: ContextHealth | null;
  hookHealth: HookHealth;
  statusDoc: string;
  scanState: ScanState;
  loading: boolean;
  authError: boolean;
  client: WolfClient | null;
}

export function useWolfData(): WolfData {
  const [loading, setLoading] = useState(true);
  const [anatomy, setAnatomy] = useState<WolfData["anatomy"]>({ entries: [], metadata: { files: 0, hits: 0, misses: 0 } });
  const [cerebrum, setCerebrum] = useState<CerebrumData>({ preferences: [], learnings: [], doNotRepeat: [], decisions: [], lastUpdated: "" });
  const [memory, setMemory] = useState<MemorySession[]>([]);
  const [tokenLedger, setTokenLedger] = useState<TokenLedger>({ lifetime: { total_tokens_estimated: 0, total_reads: 0, total_writes: 0, total_sessions: 0, anatomy_hits: 0, anatomy_misses: 0, repeated_reads_blocked: 0, estimated_savings_vs_bare_cli: 0 }, sessions: [], waste_flags: [] });
  const [cronState, setCronState] = useState<CronState>({ engine_status: "unknown", last_heartbeat: null, execution_log: [], dead_letter_queue: [] });
  const [cronManifest, setCronManifest] = useState<CronManifest>({ tasks: [] });
  const [buglog, setBuglog] = useState<BugLog>({ bugs: [] });
  const [health, setHealth] = useState<Health>({ status: "unknown", uptime_seconds: 0 });
  const [identity, setIdentity] = useState({ name: "Wolf", role: "AI development assistant" });
  const [project, setProject] = useState<ProjectMeta>({ name: "", description: "", root: "" });
  const [config, setConfig] = useState<WolfConfig>({ agents: ["claude"] });
  const [contextHealth, setContextHealth] = useState<ContextHealth | null>(null);
  const [hookHealth, setHookHealth] = useState<HookHealth>({});
  const [statusDoc, setStatusDoc] = useState("");
  const [scanState, setScanState] = useState<ScanState>({});
  const [client, setClient] = useState<WolfClient | null>(null);
  const [authError, setAuthError] = useState(false);

  // True once anatomy state came from the store: a later file_changed event
  // carrying only anatomy.md (which the hooks re-render after every write)
  // must not overwrite the richer index-derived state and drop the symbols.
  const anatomyFromIndex = useRef(false);

  const processFiles = useCallback((files: Record<string, string>) => {
    if (files["anatomy-index.json"]) {
      try {
        const store = JSON.parse(files["anatomy-index.json"]);
        const entries = Object.entries(store.files ?? {}).map(([relPath, e]: [string, any]) => {
          const slash = relPath.lastIndexOf("/");
          return {
            file: slash === -1 ? relPath : relPath.slice(slash + 1),
            description: e.description ?? "",
            tokens: e.tokens ?? 0,
            section: slash === -1 ? "./" : relPath.slice(0, slash + 1),
            symbols: e.symbols,
            importance: e.importance,
          };
        });
        setAnatomy({
          entries,
          metadata: { files: entries.length, hits: store.meta?.hits ?? 0, misses: store.meta?.misses ?? 0 },
        });
        anatomyFromIndex.current = true;
      } catch {
        if (files["anatomy.md"] && !anatomyFromIndex.current) setAnatomy(parseAnatomy(files["anatomy.md"]));
      }
    } else if (files["anatomy.md"] && !anatomyFromIndex.current) setAnatomy(parseAnatomy(files["anatomy.md"]));
    if (files["cerebrum.md"]) setCerebrum(parseCerebrum(files["cerebrum.md"]));
    if (files["memory.md"]) setMemory(parseMemory(files["memory.md"]));
    if (files["token-ledger.json"]) {
      try { setTokenLedger(JSON.parse(files["token-ledger.json"])); } catch {}
    }
    if (files["cron-state.json"]) {
      try { setCronState(JSON.parse(files["cron-state.json"])); } catch {}
    }
    if (files["cron-manifest.json"]) {
      try { setCronManifest(JSON.parse(files["cron-manifest.json"])); } catch {}
    }
    if (files["buglog.json"]) {
      // A hand-written buglog is often a bare array of entries. Coerce here so
      // no panel ever sees `bugs` undefined — one malformed state file used to
      // blank the whole dashboard from ProjectOverview's first render.
      try {
        const b = JSON.parse(files["buglog.json"]);
        setBuglog(Array.isArray(b) ? { bugs: b } : Array.isArray(b?.bugs) ? b : { bugs: [] });
      } catch {}
    }
    if (files["config.json"]) {
      try {
        const cfg = JSON.parse(files["config.json"]);
        setConfig({ agents: cfg?.openwolf?.agents ?? ["claude"], context: cfg?.openwolf?.context, reads: cfg?.openwolf?.reads });
      } catch {}
    }
    if (files["STATUS.md"] !== undefined && files["STATUS.md"] !== "") setStatusDoc(files["STATUS.md"]);
    if (files["_scan-state.json"]) {
      try { setScanState(JSON.parse(files["_scan-state.json"])); } catch {}
    }
    if (files["hooks/_heartbeat.json"]) {
      try { setHookHealth(JSON.parse(files["hooks/_heartbeat.json"])); } catch {}
    }
    if (files["identity.md"]) {
      const nameMatch = files["identity.md"].match(/\*\*Name:\*\*\s*(.+)/);
      const roleMatch = files["identity.md"].match(/\*\*Role:\*\*\s*(.+)/);
      if (nameMatch || roleMatch) {
        setIdentity({
          name: nameMatch?.[1]?.trim() || "Wolf",
          role: roleMatch?.[1]?.trim() || "AI development assistant",
        });
      }
    }
  }, []);

  useEffect(() => {
    // Initial fetch. Never feed a non-OK response body into state: a 401 error
    // object like {error:"..."} would overwrite defaults and crash the UI.
    dashboardFetch("/api/files")
      .then(r => {
        if (r.status === 401) { setAuthError(true); throw new Error("unauthorized"); }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(files => {
        processFiles(files);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    dashboardFetch("/api/health")
      .then(r => (r.ok ? r.json() : null))
      .then(h => { if (h && typeof h.status === "string") setHealth(h); })
      .catch(() => {});

    dashboardFetch("/api/project")
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (p && typeof p.name === "string") setProject(p); })
      .catch(() => {});

    dashboardFetch("/api/context-health")
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (c && Array.isArray(c.findings)) setContextHealth(c); })
      .catch(() => {});

    // WebSocket
    const wsClient = new WolfClient();
    wsClient.connect();
    setClient(wsClient);

    wsClient.onMessage((msg) => {
      if (msg.type === "file_changed") {
        processFiles({ [msg.file]: msg.content });
      }
      if (msg.type === "full_state" && msg.files) {
        processFiles(msg.files);
      }
      if (msg.type === "health") {
        setHealth({ status: msg.status, uptime_seconds: msg.uptime });
      }
    });

    return () => wsClient.disconnect();
  }, [processFiles]);

  return { anatomy, cerebrum, memory, tokenLedger, cronState, cronManifest, buglog, health, identity, project, config, contextHealth, hookHealth, statusDoc, scanState, loading, authError, client };
}
