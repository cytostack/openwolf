import { useState, useEffect, useCallback } from "react";
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
    estimated_savings_vs_bare_cli: number;
    real_input_tokens?: number;
    real_output_tokens?: number;
    real_cache_read_tokens?: number;
    real_cache_creation_tokens?: number;
    real_api_calls?: number;
  };
  sessions: LedgerSession[];
  waste_flags: any[];
}

export interface WolfConfig {
  agents: string[];
  context?: { session_digest_budget_tokens?: number; budgets?: Record<string, number> };
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
  suggestions: any;
  health: Health;
  identity: { name: string; role: string };
  project: ProjectMeta;
  config: WolfConfig;
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
  const [suggestions, setSuggestions] = useState<any>(null);
  const [health, setHealth] = useState<Health>({ status: "unknown", uptime_seconds: 0 });
  const [identity, setIdentity] = useState({ name: "Wolf", role: "AI development assistant" });
  const [project, setProject] = useState<ProjectMeta>({ name: "", description: "", root: "" });
  const [config, setConfig] = useState<WolfConfig>({ agents: ["claude"] });
  const [statusDoc, setStatusDoc] = useState("");
  const [scanState, setScanState] = useState<ScanState>({});
  const [client, setClient] = useState<WolfClient | null>(null);
  const [authError, setAuthError] = useState(false);

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
          };
        });
        setAnatomy({
          entries,
          metadata: { files: entries.length, hits: store.meta?.hits ?? 0, misses: store.meta?.misses ?? 0 },
        });
      } catch {
        if (files["anatomy.md"]) setAnatomy(parseAnatomy(files["anatomy.md"]));
      }
    } else if (files["anatomy.md"]) setAnatomy(parseAnatomy(files["anatomy.md"]));
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
      try { setBuglog(JSON.parse(files["buglog.json"])); } catch {}
    }
    if (files["suggestions.json"]) {
      try { setSuggestions(JSON.parse(files["suggestions.json"])); } catch {}
    }
    if (files["config.json"]) {
      try {
        const cfg = JSON.parse(files["config.json"]);
        setConfig({ agents: cfg?.openwolf?.agents ?? ["claude"], context: cfg?.openwolf?.context });
      } catch {}
    }
    if (files["STATUS.md"] !== undefined && files["STATUS.md"] !== "") setStatusDoc(files["STATUS.md"]);
    if (files["_scan-state.json"]) {
      try { setScanState(JSON.parse(files["_scan-state.json"])); } catch {}
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

  return { anatomy, cerebrum, memory, tokenLedger, cronState, cronManifest, buglog, suggestions, health, identity, project, config, statusDoc, scanState, loading, authError, client };
}
