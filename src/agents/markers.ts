import * as fs from "node:fs";
import * as path from "node:path";

const BEGIN = "<!-- openwolf:begin -->";
const END = "<!-- openwolf:end -->";

/**
 * Insert or replace the OpenWolf-managed block in a markdown context file
 * (AGENTS.md, GEMINI.md, …). Everything outside the markers is user content
 * and is preserved byte-for-byte. Returns true if the file changed.
 */
export function upsertMarkerBlock(filePath: string, content: string): boolean {
  const block = `${BEGIN}\n${content.trim()}\n${END}`;
  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {}

  let next: string;
  if (existing.includes(BEGIN) && existing.includes(END)) {
    const pattern = new RegExp(`${BEGIN}[\\s\\S]*?${END}`);
    next = existing.replace(pattern, block);
  } else if (existing.trim().length > 0) {
    next = existing.replace(/\s*$/, "\n\n") + block + "\n";
  } else {
    next = block + "\n";
  }

  if (next === existing) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf-8");
  return true;
}
