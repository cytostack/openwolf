import * as fs from "node:fs"
import * as path from "node:path"
import { getWolfDir, getSessionFilePath, writeJSON, readJSON, normalizePath } from "./fs.js"
import { lookupEntry } from "./anatomy.js"
import type { PartialSessionState } from "./types.js"

export function handlePreRead(directory: string, sessionId: string, filePath: string, isRangedRead = false): void {
  const wolfDir = getWolfDir(directory)
  if (!fs.existsSync(wolfDir)) return

  const sessionFile = getSessionFilePath(directory, sessionId)
  const normalizedFile = normalizePath(filePath)

  const projectDir = normalizePath(directory)
  const relToProject = normalizedFile.startsWith(projectDir)
    ? normalizedFile.slice(projectDir.length).replace(/^\//, "")
    : ""
  if (relToProject.startsWith(".wolf/") || relToProject.startsWith(".wolf\\")) return

  // Ranged reads (offset/limit) are exactly what the symbol hints steer the
  // model toward — never warn about them or record them as full reads (a
  // ranged first contact must not make a later legitimate full read look like
  // a duplicate).
  if (isRangedRead) return

  const session = readJSON<PartialSessionState>(sessionFile, {
    session_id: "", files_read: {}, anatomy_hits: 0, anatomy_misses: 0,
    repeated_reads_warned: 0,
  })

  if (!session.files_read) session.files_read = {}

  // Repeat detection is mtime-gated (issue #41): only warn while the file is
  // unchanged since the recorded read. A modified file is a legitimate
  // re-read — drop the stale record and track it fresh below.
  if (session.files_read[normalizedFile]) {
    const prev = session.files_read[normalizedFile]
    let modifiedSinceRead = true
    try {
      const mtime = fs.statSync(filePath).mtimeMs
      modifiedSinceRead = prev.read_mtime === undefined || mtime > prev.read_mtime
    } catch {}
    if (!modifiedSinceRead) {
      prev.count++
      session.repeated_reads_warned = (session.repeated_reads_warned || 0) + 1
      console.warn(`OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${prev.tokens} tok), unchanged since. If you only need the gist, your earlier read may suffice; for exact text (edit anchors, line numbers), the re-read is fine.`)
      writeJSON(sessionFile, session)
      return
    }
    delete session.files_read[normalizedFile]
  }

  // Anatomy lookup: O(1) against the durable store, legacy md scan fallback.
  const entry = lookupEntry(wolfDir, projectDir, normalizedFile)
  const found = entry !== null
  if (entry) {
    if (entry.description) {
      console.warn(`OpenWolf anatomy: ${entry.file}: ${entry.description} (~${entry.tokens} tok)`)
    }

    // Symbol hint: point at slices of big files. Suppressed if the on-disk
    // file no longer matches what was indexed — a stale line range that
    // misdirects an offset read is worse than no hint at all.
    if (entry.symbols && entry.symbols.length > 0) {
      let fresh = false
      try {
        const st = fs.statSync(filePath)
        fresh = (entry.size === undefined || st.size === entry.size) &&
                (entry.mtimeMs === undefined || Math.abs(st.mtimeMs - entry.mtimeMs) < 1)
      } catch {}
      if (fresh) {
        const top = [...entry.symbols].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
        const list = top.map((s) => `${s.kind} ${s.name} L${s.startLine}-${s.endLine} ~${s.tokens} tok`).join("; ")
        console.warn(`Largest sections: ${list}. Read with offset/limit to fetch just the part you need.`)
      }
    }
  }

  session.anatomy_hits = (session.anatomy_hits || 0) + (found ? 1 : 0)
  session.anatomy_misses = (session.anatomy_misses || 0) + (found ? 0 : 1)

  // Record initial read entry (tokens will be updated in post-read)
  let readMtime: number | undefined
  try {
    readMtime = fs.statSync(filePath).mtimeMs
  } catch {}
  session.files_read[normalizedFile] = {
    count: 1,
    tokens: 0,
    first_read: new Date().toISOString(),
    read_mtime: readMtime,
    anatomy_hit: found,
  }

  writeJSON(sessionFile, session)
}
