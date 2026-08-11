import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, writeJSON, readJSON, normalizePath, readMarkdown } from "./fs.js"
import { parseAnatomy } from "./anatomy.js"
import type { PartialSessionState } from "./types.js"

export function handlePreRead(directory: string, sessionId: string, filePath: string): void {
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

  const session = readJSON<PartialSessionState>(sessionFile, {
    session_id: "", files_read: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0,
  })

  if (!session.files_read) session.files_read = {}

  if (session.files_read[normalizedFile]) {
    const prev = session.files_read[normalizedFile]
    console.warn(`⚡ OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tokens). Consider using your existing knowledge of this file.`)
    session.files_read[normalizedFile].count++
    session.repeated_reads_warned = (session.repeated_reads_warned || 0) + 1
    writeJSON(sessionFile, session)
    return
  }

  const anatomyContent = readMarkdown(path.join(wolfDir, "anatomy.md"))
  const sections = parseAnatomy(anatomyContent)
  let found = false

  for (const [sectionKey, entries] of sections) {
    for (const entry of entries) {
      const entryRelPath = normalizePath(path.join(sectionKey, entry.file))
      if (normalizedFile.endsWith(entryRelPath) || normalizedFile.endsWith("/" + entryRelPath)) {
        console.warn(`📋 OpenWolf anatomy: ${entry.file} — ${entry.description} (~${entry.tokens} tok)`)
        found = true
        break
      }
    }
    if (found) break
  }

  session.anatomy_hits = (session.anatomy_hits || 0) + (found ? 1 : 0)
  session.anatomy_misses = (session.anatomy_misses || 0) + (found ? 0 : 1)

  session.files_read[normalizedFile] = {
    count: 1,
    tokens: 0,
    first_read: new Date().toISOString(),
  }

  writeJSON(sessionFile, session)
}