#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type JsonRecord = Record<string, unknown>;

interface NormalizedHookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: JsonRecord;
  tool_output?: { content?: string };
  tool_response?: unknown;
}

interface FileChange {
  filePath: string;
  content?: string;
  oldString?: string;
  newString?: string;
  toolName?: string;
}

const SCRIPT_BY_ACTION = new Map<string, string>([
  ["session-start", "session-start.js"],
  ["pre-read", "pre-read.js"],
  ["pre-write", "pre-write.js"],
  ["post-read", "post-read.js"],
  ["post-write", "post-write.js"],
  ["stop", "stop.js"],
]);

const SHELL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "shell_command",
  "functions.shell_command",
]);

const APPLY_PATCH_TOOL_NAMES = new Set([
  "apply_patch",
  "functions.apply_patch",
]);

const MULTI_TOOL_NAMES = new Set([
  "multi_tool_use.parallel",
  "functions.multi_tool_use.parallel",
]);

const READ_TOOL_NAMES = new Set([
  "read",
  "view",
  "glob",
  "grep",
  "ls",
]);

const WRITE_TOOL_NAMES = new Set([
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "create",
]);

const action = process.argv[2] || "";
const scriptName = SCRIPT_BY_ACTION.get(action);
if (!scriptName) {
  process.exit(0);
}

const rawPayload = await readStdin();
const hookInput = parseJson(rawPayload);
const startDirectory = findStartDirectory(hookInput);
const projectRoot = findWolfProjectRoot(startDirectory);

if (!projectRoot) {
  process.exit(0);
}

const scriptPath = path.join(projectRoot, ".wolf", "hooks", scriptName);
if (!fs.existsSync(scriptPath)) {
  process.exit(0);
}

const normalizedInputs = normalizeForAction(action, hookInput, projectRoot);
if (normalizedInputs.length === 0) {
  process.exit(0);
}

let exitCode = 0;
for (const input of normalizedInputs) {
  const code = await runOpenWolfHook(scriptPath, projectRoot, input);
  if (code !== 0) exitCode = code;
}

process.exit(exitCode);

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks).toString("utf8") : "{}"), 2000);
  });
}

function parseJson(raw: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeForAction(actionName: string, input: JsonRecord, projectRoot: string): NormalizedHookInput[] {
  if (actionName === "session-start" || actionName === "stop") {
    return [withBaseFields(input, projectRoot)];
  }

  if (actionName === "pre-read" || actionName === "post-read") {
    return buildReadInputs(input, projectRoot);
  }

  if (actionName === "pre-write" || actionName === "post-write") {
    return buildWriteInputs(input, projectRoot, actionName === "post-write");
  }

  return [];
}

function buildReadInputs(input: JsonRecord, projectRoot: string): NormalizedHookInput[] {
  const toolName = getToolName(input);
  const normalizedToolName = normalizeToolName(toolName);
  const toolInput = getToolInput(input);

  if (MULTI_TOOL_NAMES.has(normalizedToolName)) {
    return getParallelToolUses(toolInput).flatMap((toolUse) => buildReadInputs(toolUse, projectRoot));
  }

  const paths = new Set<string>();
  if (READ_TOOL_NAMES.has(normalizedToolName)) {
    for (const filePath of getPathValues(toolInput)) paths.add(filePath);
  }

  if (SHELL_TOOL_NAMES.has(normalizedToolName)) {
    const command = getCommand(toolInput);
    if (isShellReadCommand(command)) {
      for (const filePath of extractShellReadPaths(command, projectRoot)) paths.add(filePath);
    }
  }

  const output = outputToString(getToolOutput(input));
  return [...paths]
    .map((filePath) => resolveExistingFile(filePath, projectRoot))
    .filter((filePath): filePath is string => Boolean(filePath))
    .map((filePath) => ({
      ...withBaseFields(input, projectRoot),
      tool_name: "Read",
      tool_input: { file_path: filePath },
      tool_output: { content: output },
    }));
}

function buildWriteInputs(input: JsonRecord, projectRoot: string, skipDeletedFiles: boolean): NormalizedHookInput[] {
  const toolName = getToolName(input);
  const normalizedToolName = normalizeToolName(toolName);
  const toolInput = getToolInput(input);

  if (MULTI_TOOL_NAMES.has(normalizedToolName)) {
    return getParallelToolUses(toolInput).flatMap((toolUse) => buildWriteInputs(toolUse, projectRoot, skipDeletedFiles));
  }

  let changes: FileChange[] = [];
  if (APPLY_PATCH_TOOL_NAMES.has(normalizedToolName)) {
    changes = parseApplyPatchChanges(toolInput, projectRoot, skipDeletedFiles);
  } else if (WRITE_TOOL_NAMES.has(normalizedToolName)) {
    changes = getPathValues(toolInput).map((filePath) => ({
      filePath,
      content: stringValue(toolInput.content),
      oldString: stringValue(toolInput.old_string),
      newString: stringValue(toolInput.new_string),
      toolName: denormalizeWriteToolName(normalizedToolName),
    }));
  } else if (SHELL_TOOL_NAMES.has(normalizedToolName)) {
    const command = getCommand(toolInput);
    if (isShellWriteCommand(command)) {
      changes = extractShellWritePaths(command, projectRoot).map((filePath) => ({
        filePath,
        content: command,
        newString: command,
        toolName: "Edit",
      }));
    }
  }

  return changes
    .map((change) => ({
      change,
      filePath: resolveWritePath(change.filePath, projectRoot),
    }))
    .filter(({ filePath }) => Boolean(filePath))
    .map(({ change, filePath }) => ({
      ...withBaseFields(input, projectRoot),
      tool_name: change.toolName || "Edit",
      tool_input: {
        file_path: filePath,
        content: change.content || "",
        old_string: change.oldString || "",
        new_string: change.newString || "",
      },
    }));
}

function parseApplyPatchChanges(toolInput: JsonRecord, projectRoot: string, skipDeletedFiles: boolean): FileChange[] {
  const patch = extractPatchText(toolInput);
  if (!patch) return [];

  const changes: FileChange[] = [];
  let current: (FileChange & { deleted?: boolean; addedLines: string[]; removedLines: string[] }) | null = null;

  const finishCurrent = () => {
    if (!current) return;
    if (current.deleted && skipDeletedFiles) {
      current = null;
      return;
    }
    const oldString = current.removedLines.join("\n");
    const newString = current.addedLines.join("\n");
    changes.push({
      filePath: current.filePath,
      content: newString,
      oldString,
      newString,
      toolName: current.addedLines.length > 0 && current.removedLines.length === 0 ? "Write" : "Edit",
    });
    current = null;
  };

  for (const line of patch.split(/\r?\n/)) {
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      finishCurrent();
      current = {
        filePath: resolveWritePath(fileMatch[2].trim(), projectRoot) || fileMatch[2].trim(),
        deleted: fileMatch[1] === "Delete",
        addedLines: [],
        removedLines: [],
      };
      continue;
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch && current) {
      current.filePath = resolveWritePath(moveMatch[1].trim(), projectRoot) || moveMatch[1].trim();
      continue;
    }

    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removedLines.push(line.slice(1));
    }
  }

  finishCurrent();
  return changes;
}

function extractPatchText(toolInput: JsonRecord): string {
  if (typeof toolInput.patch === "string") return toolInput.patch;
  if (typeof toolInput.input === "string") return toolInput.input;
  if (typeof toolInput.content === "string") return toolInput.content;
  if (typeof toolInput.command === "string" && toolInput.command.includes("*** Begin Patch")) return toolInput.command;
  return "";
}

function withBaseFields(input: JsonRecord, projectRoot: string): NormalizedHookInput {
  const cwd = findStartDirectory(input) || projectRoot;
  return {
    hook_event_name: typeof input.hook_event_name === "string" ? input.hook_event_name : undefined,
    session_id: typeof input.session_id === "string" ? input.session_id : typeof input.sessionId === "string" ? input.sessionId : undefined,
    cwd,
  };
}

function getToolName(input: JsonRecord): string {
  if (typeof input.tool_name === "string") return input.tool_name;
  if (typeof input.toolName === "string") return input.toolName;
  if (typeof input.recipient_name === "string") return input.recipient_name;
  if (typeof input.name === "string") return input.name;
  return "";
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function denormalizeWriteToolName(name: string): string {
  if (name === "write" || name === "create") return "Write";
  if (name === "multiedit") return "MultiEdit";
  return "Edit";
}

function getToolInput(input: JsonRecord): JsonRecord {
  const raw = input.tool_input ?? input.toolArgs ?? input.parameters ?? input.args ?? {};
  if (isRecord(raw)) return raw;
  if (typeof raw === "string") return { input: raw };
  return {};
}

function getParallelToolUses(toolInput: JsonRecord): JsonRecord[] {
  if (!Array.isArray(toolInput.tool_uses)) return [];
  return toolInput.tool_uses
    .filter(isRecord)
    .map((toolUse) => ({
      tool_name: typeof toolUse.recipient_name === "string" ? toolUse.recipient_name : getToolName(toolUse),
      tool_input: isRecord(toolUse.parameters) ? toolUse.parameters : {},
    }));
}

function getToolOutput(input: JsonRecord): unknown {
  return input.tool_output ?? input.tool_response ?? input.tool_result ?? input.toolResult ?? input.output ?? input.result;
}

function outputToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(outputToString).filter(Boolean).join("\n");
  if (isRecord(value)) {
    for (const key of ["content", "stdout", "stderr", "output", "text_result_for_llm", "textResultForLlm"]) {
      const nested = value[key];
      if (typeof nested === "string") return nested;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function getPathValues(toolInput: JsonRecord): string[] {
  const keys = ["file_path", "path", "file", "filename"];
  const values: string[] = [];
  for (const key of keys) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) values.push(value);
  }
  if (Array.isArray(toolInput.files)) {
    for (const value of toolInput.files) {
      if (typeof value === "string" && value.trim()) values.push(value);
    }
  }
  return values;
}

function getCommand(toolInput: JsonRecord): string {
  return typeof toolInput.command === "string" ? toolInput.command : "";
}

function isShellReadCommand(command: string): boolean {
  return /\b(Get-Content|gc|cat|type|Select-String|rg|grep|sed|nl|Get-ChildItem|gci|ls|dir)\b/i.test(command);
}

function isShellWriteCommand(command: string): boolean {
  return /\b(Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item)\b/i.test(command) || /(^|[^>])>{1,2}\s*["']?[^"'\s]+/m.test(command);
}

function extractShellReadPaths(command: string, projectRoot: string): string[] {
  const tokens = tokenizeCommand(command);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    if (["-path", "-literalpath"].includes(lower) && tokens[i + 1]) {
      paths.push(tokens[i + 1]);
      i++;
      continue;
    }
    if (looksLikePath(token)) {
      paths.push(token);
    }
  }
  return unique(paths.filter((candidate) => Boolean(resolveExistingFile(candidate, projectRoot))));
}

function extractShellWritePaths(command: string, projectRoot: string): string[] {
  const paths: string[] = [];
  const redirection = command.matchAll(/(?:^|[^>])>{1,2}\s*("[^"]+"|'[^']+'|\S+)/g);
  for (const match of redirection) paths.push(stripQuotes(match[1]));

  const tokens = tokenizeCommand(command);
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (["-path", "-literalpath", "-filepath", "-destination"].includes(lower) && tokens[i + 1]) {
      paths.push(tokens[i + 1]);
      i++;
    }
  }

  return unique(paths.map((candidate) => resolveWritePath(candidate, projectRoot)).filter((candidate): candidate is string => Boolean(candidate)));
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
  }
  return tokens;
}

function looksLikePath(token: string): boolean {
  if (!token || token.startsWith("-")) return false;
  if (/^[|;&]$/.test(token)) return false;
  if (/^(https?:)?\/\//i.test(token)) return false;
  if (/[*?]/.test(token)) return false;
  if (/^[A-Za-z_][\w-]*$/.test(token)) return false;
  return /[\\/]|\.([A-Za-z0-9]{1,8})$/.test(token);
}

function resolveExistingFile(filePath: string, projectRoot: string): string | null {
  const resolved = resolveWritePath(filePath, projectRoot);
  if (!resolved) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

function resolveWritePath(filePath: string, projectRoot: string): string | null {
  const clean = stripQuotes(filePath).replace(/[),;]+$/g, "");
  if (!clean || clean.startsWith("-") || /^(https?:)?\/\//i.test(clean)) return null;
  try {
    const resolved = path.resolve(projectRoot, clean);
    return isInsideProject(resolved, projectRoot) ? resolved : null;
  } catch {
    return null;
  }
}

function isInsideProject(filePath: string, projectRoot: string): boolean {
  const relative = path.relative(projectRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["'`]|["'`]$/g, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function findStartDirectory(input: JsonRecord): string {
  const toolInput = getToolInput(input);
  const candidates = [
    typeof input.cwd === "string" ? input.cwd : "",
    typeof toolInput.workdir === "string" ? toolInput.workdir : "",
    process.env.OPENWOLF_PROJECT_DIR || "",
    process.env.CODEX_PROJECT_DIR || "",
    process.env.CLAUDE_PROJECT_DIR || "",
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        return stat.isDirectory() ? resolved : path.dirname(resolved);
      }
    } catch {}
  }

  return process.cwd();
}

function findWolfProjectRoot(startDirectory: string): string | null {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, ".wolf", "hooks"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function runOpenWolfHook(scriptPath: string, projectRoot: string, input: NormalizedHookInput): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        OPENWOLF_PROJECT_DIR: projectRoot,
        CODEX_PROJECT_DIR: projectRoot,
        CLAUDE_PROJECT_DIR: projectRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdin.end(JSON.stringify(input));
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on("error", () => resolve(0));
    child.on("close", (code) => resolve(code ?? 0));
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
