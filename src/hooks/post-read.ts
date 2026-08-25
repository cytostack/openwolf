import * as path from "node:path";
import { getWolfDir, ensureWolfDir, mutateSession, estimateTokens, readStdin, normalizePath, getProjectDir, hookMain, getSessionFilePath, SessionLockTimeoutError } from "./shared.js";
import { lookupEntry } from "./anatomy-store.js";

interface SessionData {
  files_read: Record<string, { count: number; tokens: number; first_read: string; ranged?: boolean }>;
  [key: string]: unknown;
}

/**
 * The PostToolUse payload carries the tool result in `tool_response`, whose
 * shape depends on the tool and harness version: a plain string, an array of
 * content blocks, or a structured object ({content} or {file:{content}}).
 * Older builds of this hook read a `tool_output` field that never existed in
 * Claude Code's payload, so read-token tracking was always zero (issue: the
 * ledger under-reported every session).
 */
function extractToolResponseText(resp: unknown): string {
  if (typeof resp === "string") return resp;
  if (Array.isArray(resp)) {
    return resp
      .map((block) => (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
      .join("");
  }
  if (resp && typeof resp === "object") {
    const obj = resp as { content?: unknown; file?: { content?: unknown } };
    if (typeof obj.content === "string") return obj.content;
    if (obj.file && typeof obj.file.content === "string") return obj.file.content;
  }
  return "";
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();

  const raw = await readStdin();
  let input: {
    tool_input?: { file_path?: string; path?: string; offset?: number; limit?: number };
    tool_response?: unknown;
    tool_output?: { content?: string };
    session_id?: string;
  };
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const sessionFile = getSessionFilePath(input);

  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  const content = extractToolResponseText(input.tool_response) || input.tool_output?.content || "";
  if (!filePath) { return; }

  // Ranged reads: pre-read already recorded the contact with ranged:true.
  // Registering them as full reads here is what used to make a later
  // legitimate full read look like a duplicate (~20x warning inflation).
  if (input.tool_input?.offset !== undefined || input.tool_input?.limit !== undefined) {
    return;
  }

  const normalizedFile = normalizePath(filePath);

  // Skip tracking for .wolf/ internal files — consistent with pre-read
  const projectDir = normalizePath(getProjectDir());
  const relToProject = normalizedFile.startsWith(projectDir)
    ? normalizedFile.slice(projectDir.length).replace(/^\//, "")
    : "";
  if (relToProject.startsWith(".wolf/") || relToProject.startsWith(".wolf\\")) {
    // 2.4: measure OpenWolf's own context cost instead of hiding it. Tagged
    // separately from project reads so anatomy hit-rates stay meaningful.
    try {
      if (content) {
        await mutateSession<SessionData>(sessionFile, { files_read: {} }, (session) => {
          const tok = estimateTokens(content, "prose");
          session.wolf_internal_tokens = ((session.wolf_internal_tokens as number) ?? 0) + tok;
          const perFile = (session.wolf_internal_reads ?? {}) as Record<string, number>;
          perFile[relToProject] = (perFile[relToProject] ?? 0) + tok;
          session.wolf_internal_reads = perFile;
        });
      }
    } catch (error) {
      if (error instanceof SessionLockTimeoutError) throw error;
    }
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".css", ".json", ".yaml", ".yml"]);
  const proseExts = new Set([".md", ".txt", ".rst"]);
  const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed";

  let tokens = content ? estimateTokens(content, type as "code" | "prose" | "mixed") : 0;

  // Fallback: if tool_output had no content, use the anatomy token estimate
  if (tokens === 0) {
    const entry = lookupEntry(wolfDir, projectDir, normalizedFile);
    if (entry) tokens = entry.tokens;
  }

  await mutateSession<SessionData>(sessionFile, { files_read: {} }, (session) => {
    if (!session.files_read) session.files_read = {};
    const existing = session.files_read[normalizedFile];
    if (existing && existing.ranged !== true) {
      existing.tokens = tokens;
    } else {
      // Fresh full read (or an upgrade of a ranged-only contact to a full read).
      session.files_read[normalizedFile] = {
        count: 1,
        tokens,
        first_read: existing?.first_read ?? new Date().toISOString(),
      };
    }
  });
}

hookMain("post-read", main);
