// Canonical spec-injection format for the Kilo plugin. This is a self-contained
// copy of the format in src/specs/inject.ts buildSpecContext — the plugin is
// shipped standalone into user projects and cannot import src/specs. Keep the
// two in sync; tests/specs.test.ts asserts they produce identical strings.

export function formatSpecContext(
  activeSpec: string | null | undefined,
  phase: string | null | undefined,
  currentTask: string | null | undefined,
): string {
  if (!activeSpec) return ""
  let line = `📋 OpenWolf spec: ${activeSpec} · phase ${phase}`
  if (currentTask) line += ` · task ${currentTask}`
  return line
}
