/**
 * Central registry of all OpenWolf-managed projects.
 * Stored at ~/.openwolf/registry.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CLI_LOCK_BUDGET_MS, withFileLock } from "../hooks/anatomy-lock.js";

export interface RegisteredProject {
  root: string;
  name: string;
  registered_at: string;
  last_updated: string;
  version: string;
}

export interface Registry {
  version: number;
  projects: RegisteredProject[];
}

export function getRegistryDir(): string {
  return path.join(os.homedir(), ".openwolf");
}

export function getRegistryPath(): string {
  return path.join(getRegistryDir(), "registry.json");
}

export function readRegistry(): Registry {
  const registryPath = getRegistryPath();
  try {
    const raw = fs.readFileSync(registryPath, "utf-8");
    return JSON.parse(raw) as Registry;
  } catch {
    return { version: 1, projects: [] };
  }
}

export function writeRegistry(registry: Registry): void {
  const dir = getRegistryDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Atomic tmp+rename: concurrent `openwolf init` runs in two projects used
  // to interleave plain writes and corrupt or lose registry entries.
  const target = getRegistryPath();
  const tmp = target + "." + Math.random().toString(16).slice(2, 10) + ".tmp";
  const body = JSON.stringify(registry, null, 2);
  try {
    fs.writeFileSync(tmp, body, "utf-8");
    fs.renameSync(tmp, target);
  } catch {
    try { fs.writeFileSync(target, body, "utf-8"); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/**
 * Register a project in the central registry.
 * Updates existing entry if the project root matches.
 */
export function registerProject(projectRoot: string, name: string, version: string): void {
  fs.mkdirSync(getRegistryDir(), { recursive: true });
  withFileLock(getRegistryPath() + ".lock", CLI_LOCK_BUDGET_MS, () => {
    const registry = readRegistry();
    const normalized = normalizePath(projectRoot);
    const now = new Date().toISOString();

    const existing = registry.projects.find(p => normalizePath(p.root) === normalized);
    if (existing) {
      existing.name = name;
      existing.last_updated = now;
      existing.version = version;
    } else {
      registry.projects.push({
        root: projectRoot,
        name,
        registered_at: now,
        last_updated: now,
        version,
      });
    }

    writeRegistry(registry);
  });
}

/**
 * Remove a project from the registry (e.g., if the directory no longer exists).
 */
export function unregisterProject(projectRoot: string): void {
  fs.mkdirSync(getRegistryDir(), { recursive: true });
  withFileLock(getRegistryPath() + ".lock", CLI_LOCK_BUDGET_MS, () => {
    const registry = readRegistry();
    const normalized = normalizePath(projectRoot);
    registry.projects = registry.projects.filter(p => normalizePath(p.root) !== normalized);
    writeRegistry(registry);
  });
}

/**
 * Get all registered projects, optionally filtering out ones that no longer exist.
 */
export function getRegisteredProjects(validateExists: boolean = false): RegisteredProject[] {
  const registry = readRegistry();
  if (!validateExists) return registry.projects;

  const valid: RegisteredProject[] = [];
  const removed: string[] = [];

  for (const project of registry.projects) {
    const wolfDir = path.join(project.root, ".wolf");
    if (fs.existsSync(wolfDir)) {
      valid.push(project);
    } else {
      removed.push(project.root);
    }
  }

  // Do NOT persist the prune: a temporarily unmounted volume (network drive,
  // external disk) must not permanently unregister its projects just because
  // a read-only listing ran while it was offline.
  return valid;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}
