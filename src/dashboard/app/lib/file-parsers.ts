export interface AnatomySymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  tokens: number;
}

export interface AnatomyEntry {
  symbols?: AnatomySymbol[];
  file: string;
  description: string;
  tokens: number;
  section: string;
  /** PageRank import-graph importance, 0..1 (index-derived entries only). */
  importance?: number;
}

export interface MemorySession {
  date: string;
  time: string;
  entries: Array<{ time: string; action: string; files: string; outcome: string; tokens: string }>;
}

export interface CerebrumData {
  preferences: string[];
  learnings: string[];
  doNotRepeat: Array<{ date: string; text: string }>;
  decisions: string[];
  lastUpdated: string;
}

export function parseAnatomy(content: string): { entries: AnatomyEntry[]; metadata: { files: number; hits: number; misses: number } } {
  const entries: AnatomyEntry[] = [];
  let currentSection = "";
  let files = 0, hits = 0, misses = 0;

  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    // Anchored to the generated header line: an unanchored match let any
    // description or preserved raw line containing "files: N ... hits: N ..."
    // overwrite the real counters.
    const metaMatch = line.match(/^> Files:\s*(\d+)\s*tracked.*hits:\s*(\d+).*Misses:\s*(\d+)/i);
    if (metaMatch) {
      files = parseInt(metaMatch[1]);
      hits = parseInt(metaMatch[2]);
      misses = parseInt(metaMatch[3]);
    }

    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const entryMatch = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/);
    if (entryMatch && currentSection) {
      entries.push({
        file: entryMatch[1],
        description: entryMatch[2] || "",
        tokens: parseInt(entryMatch[3]),
        section: currentSection,
      });
    }
  }

  return { entries, metadata: { files, hits, misses } };
}

export function parseMemory(content: string): MemorySession[] {
  const sessions: MemorySession[] = [];
  let current: MemorySession | null = null;

  for (const line of content.split("\n")) {
    const sessionMatch = line.match(/^## Session: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
    if (sessionMatch) {
      if (current) sessions.push(current);
      current = { date: sessionMatch[1], time: sessionMatch[2], entries: [] };
      continue;
    }

    if (current && line.startsWith("|") && !line.startsWith("|--") && !line.startsWith("| Time")) {
      // Positional split: filter(Boolean) collapsed EMPTY cells and shifted
      // every following column (an empty Outcome cell put the token count in
      // the outcome field). Slice off only the leading/trailing empties that
      // come from the outer pipes.
      const cells = line.split("|").map(s => s.trim());
      const parts = cells.slice(1, cells.length - 1);
      if (parts.filter(Boolean).length >= 3) {
        current.entries.push({
          time: parts[0] ?? "",
          action: parts[1] ?? "",
          files: parts[2] ?? "",
          outcome: parts[3] ?? "",
          tokens: parts[4] ?? "",
        });
      }
    }
  }

  if (current) sessions.push(current);
  return sessions.reverse(); // newest first
}

export function parseCerebrum(content: string): CerebrumData {
  const data: CerebrumData = { preferences: [], learnings: [], doNotRepeat: [], decisions: [], lastUpdated: "" };

  const lastUpdatedMatch = content.match(/Last updated:\s*(.+)/);
  if (lastUpdatedMatch) data.lastUpdated = lastUpdatedMatch[1].trim();

  const sections = content.split(/^## /m).slice(1);
  for (const section of sections) {
    const [title, ...rest] = section.split("\n");
    const items = rest
      .filter(l => l.trim().startsWith("-") || l.trim().startsWith("["))
      .map(l => l.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .filter(l => !l.startsWith("<!--"));

    if (title.includes("User Preferences")) {
      data.preferences = items;
    } else if (title.includes("Key Learnings")) {
      data.learnings = items;
    } else if (title.includes("Do-Not-Repeat")) {
      data.doNotRepeat = items.map(item => {
        const dateMatch = item.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*(.*)/);
        return dateMatch
          ? { date: dateMatch[1], text: dateMatch[2] }
          : { date: "", text: item };
      });
    } else if (title.includes("Decision Log")) {
      data.decisions = items;
    }
  }

  return data;
}
