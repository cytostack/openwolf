import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { safeCopyFile } from "../utils/fs-safe.js";
import { upsertMarkerBlock } from "./markers.js";
import { readSnippet } from "./index.js";
import type { AgentAdapter, AgentInstallContext, AgentInstallResult } from "./types.js";

// OpenCode integration, adapted from PR #9 by @alfasin (closes #5, #6).
// OpenCode V1 loads the multi-file plugin under .opencode/plugin/openwolf/
// plus a top-level entry. V2 uses .opencode/plugins/openwolf/index.ts and a
// default {id, setup} definition. The selected output is based on the actual
// OpenCode executable rather than on whether any config directory exists.

const ENTRY = `// OpenWolf plugin entry — implementation lives in ./openwolf/.
import {OpenWolf as installed} from "./openwolf/index.js"
import {pinRuntime, scheduleUpdate} from "./openwolf/runtime-updates.js"
import {pathToFileURL} from "node:url"
import * as path from "node:path"
import type {Plugin} from "@opencode-ai/plugin"
export const OpenWolf: Plugin = async (ctx) => {
  scheduleUpdate(ctx.directory)
  // The server's plugin instance remains fixed; no reload during a session.
  let pkg: string | undefined
  try { pkg = pinRuntime(ctx.directory, "opencode-server:" + process.pid + ":" + Date.now()) } catch {}
  if (pkg) {
    try {
      const next = await import(pathToFileURL(path.join(pkg,"src/templates/opencode-plugin/index.ts")).href)
      return await next.OpenWolf(ctx)
    } catch {} // retain the installed plugin if the staged module cannot load
  }
  return installed(ctx)
}
`;

export type OpenCodePluginApi = "v1" | "v2" | "unknown";

/** Extract a CLI version from both `2.0.22` and `opencode v2.0.22` output. */
export function parseOpenCodeVersion(output: string): string | undefined {
  const match = output.match(/(?:^|[^\d])v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?/i);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.${match[3] ?? "0"}`;
}

export function detectOpenCodeVersion(): string | undefined {
  const executable = process.platform === "win32" ? "opencode.cmd" : "opencode";
  try {
    const output = execFileSync(executable, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2000,
    });
    return parseOpenCodeVersion(String(output));
  } catch {
    return undefined;
  }
}

export function detectOpenCodePluginApi(version = detectOpenCodeVersion()): OpenCodePluginApi {
  if (!version) return "unknown";
  const major = Number.parseInt(version.split(".")[0], 10);
  return Number.isSafeInteger(major) && major >= 2 ? "v2" : "v1";
}

function managedFile(file: string, markers: string[]): boolean {
  try {
    const content = fs.readFileSync(file, "utf-8");
    return markers.some(marker => content.includes(marker));
  } catch {
    return false;
  }
}

function removeManagedFile(file: string, markers: string[], warnings: string[]): void {
  if (!fs.existsSync(file)) return;
  if (!managedFile(file, markers)) {
    warnings.push(`${file} exists but is not recognized as an OpenWolf-generated plugin; it was left untouched`);
    return;
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    warnings.push(`could not remove stale OpenWolf plugin ${file}: ${String(error)}`);
  }
}

function removeManagedDirectory(dir: string, warnings: string[]): void {
  if (!fs.existsSync(dir)) return;
  const index = path.join(dir, "index.ts");
  if (!managedFile(index, ["export const OpenWolf", "setupOpenWolfV2", "id: \"openwolf\""])) {
    warnings.push(`${dir} exists but is not recognized as an OpenWolf-generated plugin; it was left untouched`);
    return;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    warnings.push(`could not remove stale OpenWolf plugin ${dir}: ${String(error)}`);
  }
}

function existingManagedApi(projectRoot: string): Exclude<OpenCodePluginApi, "unknown"> | undefined {
  const v2Dir = path.join(projectRoot, ".opencode", "plugins", "openwolf");
  const v2Entry = path.join(projectRoot, ".opencode", "plugins", "openwolf.ts");
  if (
    managedFile(path.join(v2Dir, "index.ts"), ["setupOpenWolfV2", "id: \"openwolf\""]) ||
    managedFile(v2Entry, ["setupOpenWolfV2", "id: \"openwolf\""])
  ) return "v2";

  const v1Dir = path.join(projectRoot, ".opencode", "plugin", "openwolf");
  const v1Entry = path.join(projectRoot, ".opencode", "plugin", "openwolf.ts");
  if (
    managedFile(path.join(v1Dir, "index.ts"), ["export const OpenWolf"]) ||
    managedFile(v1Entry, ["OpenWolf plugin entry", "export const OpenWolf"])
  ) return "v1";
}

function removeOtherApiPlugins(projectRoot: string, api: OpenCodePluginApi, warnings: string[]): void {
  const v1Dir = path.join(projectRoot, ".opencode", "plugin", "openwolf");
  const v1Entry = path.join(projectRoot, ".opencode", "plugin", "openwolf.ts");
  const v2Dir = path.join(projectRoot, ".opencode", "plugins", "openwolf");
  const v2Entry = path.join(projectRoot, ".opencode", "plugins", "openwolf.ts");

  if (api === "v2") {
    removeManagedDirectory(v1Dir, warnings);
    removeManagedFile(v1Entry, ["OpenWolf plugin entry", "export const OpenWolf"], warnings);
    removeManagedFile(v2Entry, ["setupOpenWolfV2", "id: \"openwolf\""], warnings);
  } else {
    removeManagedDirectory(v2Dir, warnings);
    removeManagedFile(v2Entry, ["setupOpenWolfV2", "id: \"openwolf\""], warnings);
  }
}

function copyTemplateFiles(sourceDir: string, destinationDir: string, entry: "v1" | "v2"): void {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const file of fs.readdirSync(sourceDir)) {
    if (!file.endsWith(".ts")) continue;
    if (entry === "v2" && (file === "index.ts" || file === "index-v2.ts")) continue;
    if (entry === "v1" && file === "index-v2.ts") continue;
    safeCopyFile(path.join(sourceDir, file), path.join(destinationDir, file));
  }
}

function installV1Plugin(ctx: AgentInstallContext, sourceDir: string): void {
  const pluginDir = path.join(ctx.projectRoot, ".opencode", "plugin");
  const destinationDir = path.join(pluginDir, "openwolf");
  copyTemplateFiles(sourceDir, destinationDir, "v1");
  fs.writeFileSync(path.join(pluginDir, "openwolf.ts"), ENTRY, "utf-8");
}

function installV2Plugin(ctx: AgentInstallContext, sourceDir: string): boolean {
  const sourceEntry = path.join(sourceDir, "index-v2.ts");
  if (!fs.existsSync(sourceEntry)) return false;

  const destinationDir = path.join(ctx.projectRoot, ".opencode", "plugins", "openwolf");
  copyTemplateFiles(sourceDir, destinationDir, "v2");
  safeCopyFile(sourceEntry, path.join(destinationDir, "index.ts"));
  return true;
}

export function installOpenCodePlugin(
  ctx: AgentInstallContext,
  api = detectOpenCodePluginApi(),
): AgentInstallResult {
  const actions: string[] = [];
  const warnings: string[] = [];

  const pluginSrcDir = path.join(ctx.templatesDir, "opencode-plugin");
  if (!fs.existsSync(pluginSrcDir)) {
    warnings.push("opencode-plugin templates missing from the OpenWolf install — plugin not written");
    return { actions, warnings };
  }

  const selectedApi = api === "unknown"
    ? existingManagedApi(ctx.projectRoot) ?? "v1"
    : api;
  removeOtherApiPlugins(ctx.projectRoot, selectedApi, warnings);

  if (selectedApi === "v2") {
    if (!installV2Plugin(ctx, pluginSrcDir)) {
      warnings.push("OpenCode V2 was detected, but the V2 plugin template is missing — plugin not written");
      return { actions, warnings };
    }
    actions.push("OpenCode V2 plugin installed (.opencode/plugins/openwolf/index.ts)");
    if (api === "unknown") {
      warnings.push("OpenCode version could not be detected; kept the existing OpenCode V2 plugin contract");
    }
  } else {
    installV1Plugin(ctx, pluginSrcDir);
    actions.push("OpenCode plugin installed (.opencode/plugin/openwolf.ts)");
    if (api === "unknown") {
      warnings.push("OpenCode version could not be detected; installed the V1 plugin for compatibility");
    }
  }

  if (upsertMarkerBlock(path.join(ctx.projectRoot, "AGENTS.md"), readSnippet(ctx.templatesDir))) {
    actions.push("AGENTS.md updated (OpenWolf block)");
  }

  return { actions, warnings };
}

export const opencodeAdapter: AgentAdapter = {
  name: "opencode",
  displayName: "OpenCode",
  install(ctx: AgentInstallContext): AgentInstallResult {
    return installOpenCodePlugin(ctx);
  },
};
