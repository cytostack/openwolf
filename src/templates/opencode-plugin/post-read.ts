import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, getSessionFilePath, writeJSON, readJSON, normalizePath, estimateTokens } from "./fs.js"
import { lookupEntry } from "./anatomy.js"
import type { PartialSessionState } from "./types.js"

export function handlePostRead(directory: string, sessionId: string, filePath: string, content: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const sessionFile = getSessionFilePath(directory, sessionId)
  const normalizedFile = normalizePath(filePath)

  const projectDir = normalizePath(directory)
  const relToProject = normalizedFile.startsWith(projectDir)
    ? normalizedFile.slice(projectDir.length).replace(/^\//, "")
    : ""
  if (relToProject.startsWith(".wolf/") || relToProject.startsWith(".wolf\\")) return

  const ext = path.extname(filePath).toLowerCase()
  const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".css", ".json", ".yaml", ".yml"])
  const proseExts = new Set([".md", ".txt", ".rst"])
  const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed"

  let tokens = content ? estimateTokens(content, type as "code" | "prose" | "mixed") : 0

  // Fallback: if the tool output had no content, use the anatomy token estimate
  if (tokens === 0) {
    const entry = lookupEntry(wolfDir, projectDir, normalizedFile)
    if (entry) tokens = entry.tokens
  }

  const session = readJSON<PartialSessionState>(sessionFile, { files_read: {} })
  if (!session.files_read) session.files_read = {}
  
  if (session.files_read[normalizedFile]) {
    session.files_read[normalizedFile].tokens = tokens
  } else {
    session.files_read[normalizedFile] = {
      count: 1,
      tokens,
      first_read: new Date().toISOString(),
    }
  }

  writeJSON(sessionFile, session)
}
