import * as fs from "node:fs";
import * as path from "node:path";
import { watch } from "chokidar";
import { readJSON } from "../utils/fs-safe.js";
import type { Logger } from "../utils/logger.js";

export function startFileWatcher(
  wolfDir: string,
  logger: Logger,
  broadcast: (msg: unknown) => void
): void {
  const watcher = watch(wolfDir, {
    ignoreInitial: true,
    ignored: [
      "**/hooks/_session.json",
      "**/*.tmp",
      "**/daemon.log",
    ],
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("change", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    const fileName = path.basename(filePath as string);
    logger.debug(`File changed: ${relativePath}`);

    try {
      // DoS Protection: Skip massive files
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
  });

  watcher.on("add", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    logger.debug(`File added: ${relativePath}`);
  });

  watcher.on("unlink", (filePath) => {
    const relativePath = path.relative(wolfDir, filePath as string);
    logger.debug(`File removed: ${relativePath}`);
  });

  logger.info("File watcher started on .wolf/");
}
