import * as path from "node:path";
import { getWolfDir, ensureWolfDir, readJSON, writeJSON, estimateTokens, readStdin, normalizePath, getProjectDir, resolveProjectPath } from "./shared.js";
import { lookupEntry } from "./anatomy-store.js";

interface SessionData {
  files_read: Record<string, { count: number; tokens: number; first_read: string }>;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  ensureWolfDir();
  const wolfDir = getWolfDir();
  const hooksDir = path.join(wolfDir, "hooks");
  const sessionFile = path.join(hooksDir, "_session.json");

  const raw = await readStdin();
  let input: { tool_input?: { file_path?: string; path?: string }; tool_output?: { content?: string } };
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
    return;
  }

  const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
  const content = input.tool_output?.content ?? "";
  if (!filePath) { process.exit(0); return; }

  const projectRoot = getProjectDir();
  const resolvedPath = resolveProjectPath(projectRoot, filePath);
  if (!resolvedPath) { process.exit(0); return; }
  const { absolutePath, relativePath } = resolvedPath;
  const normalizedFile = normalizePath(absolutePath);

  // Skip tracking for .wolf/ internal files — consistent with pre-read
  if (relativePath === ".wolf" || relativePath.startsWith(".wolf/")) {
    process.exit(0);
    return;
  }

  const projectDir = normalizePath(projectRoot);
  const ext = path.extname(absolutePath).toLowerCase();
  const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".css", ".json", ".yaml", ".yml"]);
  const proseExts = new Set([".md", ".txt", ".rst"]);
  const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed";

  let tokens = content ? estimateTokens(content, type as "code" | "prose" | "mixed") : 0;

  // Fallback: if tool_output had no content, use the anatomy token estimate
  if (tokens === 0) {
    const entry = lookupEntry(wolfDir, projectDir, normalizedFile);
    if (entry) tokens = entry.tokens;
  }

  const session = readJSON<SessionData>(sessionFile, { files_read: {} });
  if (session.files_read[normalizedFile]) {
    session.files_read[normalizedFile].tokens = tokens;
  } else {
    session.files_read[normalizedFile] = {
      count: 1,
      tokens,
      first_read: new Date().toISOString(),
    };
  }

  writeJSON(sessionFile, session);
  process.exit(0);
}

main().catch(() => process.exit(0));
