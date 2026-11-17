import * as fs from "node:fs";
import * as path from "node:path";
import { watch } from "chokidar";
import { readJSON } from "../utils/fs-safe.js";
import type { Logger } from "../utils/logger.js";

// Per-session watch exclusion: issue #91 and PR #110 by @davdittrich.

export function startFileWatcher(
  wolfDir: string,
  logger: Logger,
  broadcast: (msg: unknown) => void
): void {
  const watcher = watch(wolfDir, {
    ignoreInitial: true,
    // Everything the dashboard actually consumes lives at the .wolf/ root plus
    // hooks/_heartbeat.json. Watching anything else means a filesystem read, a
    // JSON message allocation, and a websocket broadcast to every client for an
    // event no consumer maps to state (#91).
    ignored: [
      "**/hooks/_session.json",
      // Per-session hook state: written on every read, write, and Bash call,
      // once per active session. The dashboard has no consumer for these paths.
      "**/hooks/sessions/**",
      // Lock files: created and unlinked around every state mutation.
      "**/*.lock",
      // Bash output cache: single files up to the 50 MB cache cap, and the
      // 1 MB broadcast guard rejects them only AFTER stat and read.
      "**/cache/**", "**/activity/**", "**/archive/**", "**/usage/**", "**/*.pending/**",
      "**/*.tmp",
      "**/daemon.log",
      "**/daemon.pid",
    ],
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  const publish = (filePath: string) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    const fileName = path.basename(filePath as string);
    logger.debug(`File changed: ${relativePath}`);

    try {
      // DoS guard: never broadcast files above 1 MB to dashboard clients
      const stat = fs.statSync(filePath as string);
      if (stat.size > 1024 * 1024) {
        logger.warn(`Skipping broadcast for large file: ${relativePath} (${stat.size} bytes)`);
        return;
      }

      const content = fs.readFileSync(filePath as string, "utf-8");
      broadcast({
        type: "file_changed",
        file: relativePath,
        content,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // File might be in process of being written
    }

    // Hot-reload config
    if (fileName === "config.json") {
      logger.info("Config changed — hot-reload not fully implemented yet");
    }

    // Hot-reload cron manifest
    if (fileName === "cron-manifest.json") {
      logger.info("Cron manifest changed — restart daemon to apply");
    }
  };
  watcher.on("change", publish);
  watcher.on("add", publish);
  watcher.on("unlink", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    logger.debug(`File removed: ${relativePath}`);
    broadcast({type:"file_changed", file:relativePath, content:"", timestamp:new Date().toISOString()});
  });
  // chokidar emits 'error' for FS watcher failures (e.g. EMFILE after watching a
  // large tree, or ENOENT when a watched path disappears). An unhandled 'error'
  // event is re-thrown and takes the daemon down; keep going like the sibling
  // source/git watchers do.
  watcher.on("error", (error) => logger.warn(`File watcher error (continuing): ${error}`));

  logger.info("File watcher started on .wolf/");
}
