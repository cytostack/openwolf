import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Ownership record for a running OpenWolf daemon.
 *
 * Issue #78 and PR #106 by @davdittrich. That PR restricts stop/restart to the
 * project-derived PM2 process name; this file adds the same guarantee for a
 * daemon started by `openwolf dashboard`, which never registers with PM2.
 *
 * `daemon stop` used to fall back to "SIGTERM everything listening on the
 * dashboard port". Port occupancy is not ownership: a stray dev server, a
 * database, or another user's process on the default port would be killed by
 * an unrelated project's `openwolf daemon stop`. This file is the positive
 * identity that replaces that guess. It is written by the daemon itself,
 * inside the project's own `.wolf/`, only after the port is successfully bound.
 */
export interface DaemonPidRecord {
  pid: number;
  project_root: string;
  port: number;
  hostname: string;
  started_at: string;
}

export type DaemonPidStatus =
  /** A live daemon this project started. Safe to signal. */
  | "owned"
  /** No pid file at all. */
  | "missing"
  /** Pid file present but the process is gone, or belongs to another host. */
  | "stale"
  /** Pid file present but records a different project root. */
  | "foreign";

export interface DaemonPidLookup {
  status: DaemonPidStatus;
  record: DaemonPidRecord | null;
}

export function daemonPidPath(wolfDir: string): string {
  return path.join(wolfDir, "daemon.pid");
}

export function writeDaemonPidFile(wolfDir: string, projectRoot: string, port: number): void {
  const record: DaemonPidRecord = {
    pid: process.pid,
    project_root: path.resolve(projectRoot),
    port,
    hostname: os.hostname(),
    started_at: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(daemonPidPath(wolfDir), JSON.stringify(record, null, 2) + "\n", "utf-8");
  } catch {}
}

export function removeDaemonPidFile(wolfDir: string): void {
  try {
    fs.unlinkSync(daemonPidPath(wolfDir));
  } catch {}
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: the process is gone. EPERM: it exists but belongs to another
    // user, which is not ours to signal either. Both mean "do not signal".
    return false;
  }
}

/**
 * Best-effort guard against PID reuse: the recorded pid may have died and the
 * number been handed to something unrelated before `stop` runs. When `ps` is
 * available and answers, the command line must still look like our daemon.
 * When it is unavailable we fall back to the pid file alone, which already
 * pins host, project root, and liveness.
 */
function commandLineLooksLikeDaemon(pid: number): boolean {
  if (process.platform === "win32") return true;
  let out = "";
  try {
    out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return true; // ps missing or the process vanished between checks
  }
  if (!out.trim()) return true;
  return out.includes("wolf-daemon");
}

/**
 * Resolves the daemon this project is allowed to signal.
 *
 * Never infers ownership from the port. A record is "owned" only when it was
 * written on this host, for this exact project root, and the pid is still a
 * live process that still looks like the daemon.
 */
export function lookupDaemonPid(wolfDir: string, projectRoot: string): DaemonPidLookup {
  let record: DaemonPidRecord;
  try {
    const parsed = JSON.parse(fs.readFileSync(daemonPidPath(wolfDir), "utf-8")) as DaemonPidRecord;
    if (!parsed || typeof parsed !== "object" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return { status: "stale", record: null };
    }
    record = parsed;
  } catch {
    return { status: "missing", record: null };
  }

  if (record.hostname && record.hostname !== os.hostname()) {
    // .wolf/ can live on a synced or shared volume; a pid from another machine
    // is a meaningless number here.
    return { status: "stale", record };
  }
  if (path.resolve(record.project_root ?? "") !== path.resolve(projectRoot)) {
    return { status: "foreign", record };
  }
  if (!isAlive(record.pid) || !commandLineLooksLikeDaemon(record.pid)) {
    return { status: "stale", record };
  }
  return { status: "owned", record };
}
