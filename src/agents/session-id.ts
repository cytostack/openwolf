/**
 * Canonical session-id extraction across harness envelopes.
 *
 * - Kilo nests it at properties.info.id (or properties.sessionID).
 * - OpenCode / Claude put it at the top-level sessionID / session_id.
 * - Claude hooks additionally read process.env.CLAUDE_SESSION_ID, but the
 *   envelope shape is the same top-level fallback chain.
 *
 * The plugin templates (kilo-plugin / opencode-plugin) carry a self-contained
 * copy of this fallback chain because they cannot import from src/.
 */
export function canonicalSessionId(
  event: {
    properties?: Record<string, unknown>;
    sessionID?: unknown;
    session_id?: unknown;
  } & Record<string, unknown>
): string {
  const properties = (event.properties ?? {}) as Record<string, unknown>;
  const info = properties.info as { id?: unknown } | undefined;
  return String(
    info?.id ||
    properties.sessionID ||
    event.sessionID ||
    event.session_id ||
    "",
  );
}
