import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON, writeJSON } from "../utils/fs-safe.js";
import { ensureDir } from "../utils/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADAPTER_FILENAME = "openwolf_codex_hook.mjs";
const OPENWOLF_CODEX_ACTIONS = ["session-start", "pre-read", "pre-write", "post-read", "post-write", "stop"] as const;

type HookAction = typeof OPENWOLF_CODEX_ACTIONS[number];

interface HookCommand {
  type: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
}

interface HooksFile {
  hooks?: Record<string, HookMatcher[]>;
}

export interface CodexHookInstallResult {
  hooksPath: string;
  adapterPath: string;
  entryCount: number;
}

export interface CodexHookStatus {
  hooksPath: string;
  adapterPath: string;
  adapterInstalled: boolean;
  registeredActions: string[];
  missingActions: string[];
}

export function installCodexAppHooks(): CodexHookInstallResult {
  const codexHome = getCodexHome();
  const hooksDir = path.join(codexHome, "hooks");
  ensureDir(hooksDir);

  const adapterPath = path.join(hooksDir, ADAPTER_FILENAME);
  fs.writeFileSync(adapterPath, readAdapterSource(), "utf-8");

  const hooksPath = path.join(codexHome, "hooks.json");
  const existing = readJSON<HooksFile>(hooksPath, { hooks: {} });
  const merged = replaceOpenWolfCodexHooks(existing, adapterPath);
  writeJSON(hooksPath, merged);

  return {
    hooksPath,
    adapterPath,
    entryCount: OPENWOLF_CODEX_ACTIONS.length,
  };
}

export function getCodexAppHookStatus(): CodexHookStatus {
  const codexHome = getCodexHome();
  const hooksPath = path.join(codexHome, "hooks.json");
  const adapterPath = path.join(codexHome, "hooks", ADAPTER_FILENAME);
  const hooksFile = readJSON<HooksFile>(hooksPath, { hooks: {} });
  const registeredActions = findRegisteredActions(hooksFile);
  const missingActions = OPENWOLF_CODEX_ACTIONS.filter((action) => !registeredActions.includes(action));

  return {
    hooksPath,
    adapterPath,
    adapterInstalled: fs.existsSync(adapterPath),
    registeredActions,
    missingActions,
  };
}

function getCodexHome(): string {
  const explicit = process.env.CODEX_HOME;
  if (explicit && explicit.trim()) return explicit.trim();
  return path.join(os.homedir(), ".codex");
}

function replaceOpenWolfCodexHooks(existing: HooksFile, adapterPath: string): HooksFile {
  const merged: HooksFile = { ...existing, hooks: { ...(existing.hooks ?? {}) } };
  const hooks = merged.hooks!;

  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = entries.filter((entry) => !isOpenWolfCodexEntry(entry));
  }

  const command = adapterCommand(adapterPath);
  hooks.SessionStart = [
    ...(hooks.SessionStart ?? []),
    codexEntry(command("session-start"), 5, "OpenWolf: starting session"),
  ];
  hooks.PreToolUse = [
    ...(hooks.PreToolUse ?? []),
    codexEntry(command("pre-read"), 5),
    codexEntry(command("pre-write"), 5),
  ];
  hooks.PostToolUse = [
    ...(hooks.PostToolUse ?? []),
    codexEntry(command("post-read"), 5),
    codexEntry(command("post-write"), 10),
  ];
  hooks.Stop = [
    ...(hooks.Stop ?? []),
    codexEntry(command("stop"), 10),
  ];

  for (const [event, entries] of Object.entries(hooks)) {
    if (entries.length === 0) delete hooks[event];
  }

  return merged;
}

function findRegisteredActions(hooksFile: HooksFile): string[] {
  const actions = new Set<string>();
  for (const entries of Object.values(hooksFile.hooks ?? {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const command = `${hook.command ?? ""} ${hook.commandWindows ?? ""}`;
        if (!command.includes(ADAPTER_FILENAME)) continue;
        for (const action of OPENWOLF_CODEX_ACTIONS) {
          if (command.includes(` ${action}`) || command.endsWith(action)) actions.add(action);
        }
      }
    }
  }
  return [...actions].sort();
}

function isOpenWolfCodexEntry(entry: HookMatcher): boolean {
  return Boolean(entry.hooks?.some((hook) => {
    const command = `${hook.command ?? ""} ${hook.commandWindows ?? ""}`;
    return command.includes(ADAPTER_FILENAME);
  }));
}

function adapterCommand(adapterPath: string): (action: HookAction) => string {
  const escaped = adapterPath.replace(/"/g, '\\"');
  return (action) => `node "${escaped}" ${action}`;
}

function codexEntry(command: string, timeout: number, statusMessage?: string, matcher?: string): HookMatcher {
  const hook: HookCommand = {
    type: "command",
    command,
    commandWindows: command,
    timeout,
  };
  if (statusMessage) hook.statusMessage = statusMessage;

  return {
    ...(matcher ? { matcher } : {}),
    hooks: [hook],
  };
}

function readAdapterSource(): string {
  const candidates = [
    path.join(__dirname, "openwolf-codex-hook.js"),
    path.resolve(__dirname, "..", "codex", "openwolf-codex-hook.js"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const content = fs.readFileSync(candidate, "utf-8");
    return content.replace(/^#!.*\n/, "#!/usr/bin/env node\n");
  }

  throw new Error("OpenWolf Codex adapter source not found. Run `pnpm build` and retry.");
}
