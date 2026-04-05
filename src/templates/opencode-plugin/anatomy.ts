import * as fs from "node:fs"
import * as path from "node:path"
import type { AnatomyEntry } from "./types.js"

export function parseAnatomy(content: string): Map<string, AnatomyEntry[]> {
  const sections = new Map<string, AnatomyEntry[]>()
  let currentSection = ""
  for (const line of content.split("\n")) {
    const sm = line.match(/^## (.+)/)
    if (sm) {
      currentSection = sm[1].trim()
      if (!sections.has(currentSection)) sections.set(currentSection, [])
      continue
    }
    if (!currentSection) continue
    const em = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/)
    if (em) {
      sections.get(currentSection)!.push({
        file: em[1],
        description: em[2] || "",
        tokens: parseInt(em[3], 10),
      })
    }
  }
  return sections
}

export function serializeAnatomy(
  sections: Map<string, AnatomyEntry[]>,
  metadata: { lastScanned: string; fileCount: number; hits: number; misses: number }
): string {
  const lines: string[] = [
    "# anatomy.md",
    "",
    `> Auto-maintained by OpenWolf. Last scanned: ${metadata.lastScanned}`,
    `> Files: ${metadata.fileCount} tracked | Anatomy hits: ${metadata.hits} | Misses: ${metadata.misses}`,
    "",
  ]
  const keys = [...sections.keys()].sort()
  for (const key of keys) {
    lines.push(`## ${key}`)
    lines.push("")
    const entries = sections.get(key)!.sort((a, b) => a.file.localeCompare(b.file))
    for (const e of entries) {
      const desc = e.description ? ` — ${e.description}` : ""
      lines.push(`- \`${e.file}\`${desc} (~${e.tokens} tok)`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function extractDescription(filePath: string): string {
  const MAX_DESC = 150
  const basename = path.basename(filePath)
  const ext = path.extname(basename).toLowerCase()
  const known: Record<string, string> = {
    "package.json": "Node.js package manifest",
    "tsconfig.json": "TypeScript configuration",
    ".gitignore": "Git ignore rules",
    "README.md": "Project documentation",
  }
  if (known[basename]) return known[basename]

  let content: string
  try {
    const fd = fs.openSync(filePath, "r")
    const buf = Buffer.alloc(12288)
    const n = fs.readSync(fd, buf, 0, 12288, 0)
    fs.closeSync(fd)
    content = buf.subarray(0, n).toString("utf-8")
  } catch {
    return ""
  }
  if (!content.trim()) return ""

  const cap = (s: string) => s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + "..."

  if (ext === ".md" || ext === ".mdx") {
    const m = content.match(/^#{1,2}\s+(.+)$/m)
    if (m) return cap(m[1].trim())
  }

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    if (basename === "page.tsx" || basename === "page.js") return "Next.js page component"
    if (basename === "layout.tsx" || basename === "layout.js") return "Next.js layout"
    const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
      .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[]
    if (exports.length > 0 && exports.length <= 5) return `Exports ${exports.join(", ")}`
    if (exports.length > 5) return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`)
  }

  const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/)
  if (declM) return `Declares ${declM[1]}`
  return ""
}