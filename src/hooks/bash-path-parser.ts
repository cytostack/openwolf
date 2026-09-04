// ─────────────────────────────────────────────────────────────────────────────
// Bash read-command parser (2.3): extract the file path from SIMPLE single-file
// read commands so the dedupe layer can see the channel where duplicate reads
// actually happen (140 of 144 measured duplicates were cat/sed/head/tail via
// Bash, invisible to the Read-tool hooks). Shell parsing is a tarpit, so this
// is a strict allowlist of simple forms; anything with globs, multiple files,
// command substitution, or nontrivial pipes returns null.
// Dependency-free; tests load it from source.
// ─────────────────────────────────────────────────────────────────────────────

export interface BashRead {
  file: string;
  /** True when the command prints the whole file (cat with no range). */
  full: boolean;
}

const DISALLOWED = /[*?{}$`\\]|<\(|>\s|>>|\btee\b/;

/**
 * Parse a Bash command that reads one file. Returns null unless the command
 * is a simple, single-file read (optionally piped into head/tail/wc only).
 */
export function parseBashRead(command: string): BashRead | null {
  let cmd = command.trim();
  if (!cmd || DISALLOWED.test(cmd)) return null;

  // Allow a trailing simple filter that doesn't change which file was read.
  const pipeSplit = cmd.split("|");
  if (pipeSplit.length > 2) return null;
  if (pipeSplit.length === 2 && !/^\s*(head|tail|wc|grep\s+-c)\b[^|]*$/.test(pipeSplit[1])) return null;
  cmd = pipeSplit[0].trim();
  const piped = pipeSplit.length === 2;

  const tokens = cmd.split(/\s+/);
  const bin = tokens[0];

  const fileArgs = (args: string[]): string[] => args.filter((a) => !a.startsWith("-") && !/^\d+(,\d+)?[pd]?$/.test(a));

  if (bin === "cat") {
    const files = fileArgs(tokens.slice(1));
    if (files.length !== 1) return null;
    return { file: files[0], full: !piped };
  }
  if (bin === "head" || bin === "tail") {
    const files = fileArgs(tokens.slice(1));
    if (files.length !== 1) return null;
    return { file: files[0], full: false };
  }
  if (bin === "sed") {
    // Only the print form: sed -n '<range>p' file
    if (tokens[1] !== "-n") return null;
    const files = tokens.slice(2).filter((a) => !a.startsWith("-") && !/^['"]?[\d,$]+p['"]?$/.test(a));
    if (files.length !== 1) return null;
    return { file: files[0], full: false };
  }
  return null;
}
