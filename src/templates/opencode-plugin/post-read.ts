import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, writeJSON, readJSON, normalizePath, readMarkdown, estimateTokens } from "./fs.js"
import { parseAnatomy } from "./anatomy.js"
import type { PartialSessionState } from "./types.js"

export function handlePostRead(directory: string, sessionId: string, filePath: string, content: string): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const hooksDir = path.join(wolfDir, "hooks")
  const sessionFile = path.join(hooksDir, "_session.json")
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

  if (tokens === 0) {
    const anatomyContent = readMarkdown(path.join(wolfDir, "anatomy.md"))
    const sections = parseAnatomy(anatomyContent)
    for (const [, entries] of sections) {
      for (const entry of entries) {
        const entryRelPath = normalizePath(path.join(entry.file))
        if (normalizedFile.endsWith(entryRelPath) || normalizedFile.endsWith("/" + entryRelPath)) {
          tokens = entry.tokens
          break
        }
      }
      if (tokens > 0) break
    }
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