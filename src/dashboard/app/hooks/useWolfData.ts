import { useState, useEffect, useCallback } from "react";
import { WolfClient } from "../lib/wolf-client.js";
import { parseAnatomy, parseMemory, parseCerebrum } from "../lib/file-parsers.js";
import type { AnatomyEntry, MemorySession, CerebrumData } from "../lib/file-parsers.js";

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
  };
  sessions: any[];
  waste_flags: any[];
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

interface DesignQCReport {
  captured_at: string | null;
  captures: any[];
  total_size_kb: number;
  estimated_tokens: number;
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
  designqcReport: DesignQCReport | null;
  health: Health;
  identity: { name: string; role: string };
  project: ProjectMeta;
  loading: boolean;
  connected: boolean;
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
  const [designqcReport, setDesignqcReport] = useState<DesignQCReport | null>(null);
  const [health, setHealth] = useState<Health>({ status: "unknown", uptime_seconds: 0 });
  const [identity, setIdentity] = useState({ name: "Wolf", role: "AI development assistant" });
  const [project, setProject] = useState<ProjectMeta>({ name: "", description: "", root: "" });
  const [client, setClient] = useState<WolfClient | null>(null);
  const [connected, setConnected] = useState(false);

  const processFiles = useCallback((files: Record<string, string>) => {
    if (files["anatomy.md"]) setAnatomy(parseAnatomy(files["anatomy.md"]));
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
    if (files["designqc-report.json"]) {
      try { setDesignqcReport(JSON.parse(files["designqc-report.json"])); } catch {}
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
    // Initial fetch
    fetch("/api/files")
      .then(r => r.json())
      .then(files => {
        processFiles(files);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/health")
      .then(r => r.json())
      .then(h => setHealth(h))
      .catch(() => {});

    fetch("/api/project")
      .then(r => r.json())
      .then(p => setProject(p))
      .catch(() => {});

    // WebSocket
    const wsClient = new WolfClient();
    wsClient.onStatusChange(setConnected);
    wsClient.connect();
    setClient(wsClient);

    wsClient.onMessage((msg) => {
      if (msg.type === "file_changed") {
        processFiles({ [msg.file]: msg.content });
      }
      if (msg.type === "full_state" && msg.files) {
        processFiles(msg.files);
      }
      if (msg.type === "project_switched") {
        if (msg.project) setProject(msg.project);
        if (msg.files) processFiles(msg.files);
      }
      if (msg.type === "health") {
        setHealth({ status: msg.status, uptime_seconds: msg.uptime });
      }
    });

    return () => wsClient.disconnect();
  }, [processFiles]);

  return { anatomy, cerebrum, memory, tokenLedger, cronState, cronManifest, buglog, suggestions, designqcReport, health, identity, project, loading, connected, client };
}
