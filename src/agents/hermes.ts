// HermesAdapter — installs openwolf-hermes Python plugin into Hermes' venv
// and patches ~/.hermes/config.yaml plugins.enabled.
//
// Hermes has no instructions[] / soft-prompt injection point — its plugin
// system is the only way in. The plugin ships under
// src/agents/hermes/python/ in this fork (Phase 3 alpha; PyPI publish in
// Phase 4 per ADR-001).
//
// venv discovery: real path of `hermes` binary → its `python` neighbor.
// Hermes' bundled venv is created by `uv` and may not have `pip` installed,
// so installation goes through `uv pip install --python <venv-py>`.
//
// config.yaml patching uses minimal in-process YAML manipulation: we read
// the file, regex-edit the `plugins.enabled` block, write back. We avoid
// pulling a YAML library into OpenWolf's runtime deps.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentAdapter,
  HookDecision,
  InstallOpts,
  NormalizedHookInput,
} from "./types.js";

const PLUGIN_NAME = "openwolf";

const configDir = (): string => path.join(os.homedir(), ".hermes");
const configYaml = (): string => path.join(configDir(), "config.yaml");

function which(cmd: string): string | null {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}

function realpath(p: string): string {
  return execSync(
    `python3 -c "import os, sys; print(os.path.realpath(sys.argv[1]))" ${JSON.stringify(p)}`,
    { encoding: "utf-8" },
  ).trim();
}

function findHermesVenvPython(): string | null {
  const hermesBin = which("hermes");
  if (!hermesBin) return null;
  const real = realpath(hermesBin);
  const py = path.join(path.dirname(real), "python");
  return fs.existsSync(py) ? py : null;
}

function uvBin(): string | null {
  return which("uv");
}

function pluginSourceDir(): string {
  // Resolve <openwolf-root>/src/agents/hermes/python/ relative to this compiled
  // file. At runtime this file lives at dist/src/agents/hermes.js, so the
  // source root is three levels up.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "src",
      "agents",
      "hermes",
      "python",
    ),
    path.resolve(__dirname, "hermes", "python"), // dev: source-relative
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "pyproject.toml"))) return p;
  }
  throw new Error(
    "openwolf-hermes Python sources not found. Expected at src/agents/hermes/python/.",
  );
}

function patchConfigYamlEnable(): void {
  const target = configYaml();
  if (!fs.existsSync(target)) {
    throw new Error(`hermes config not found at ${target}`);
  }
  const text = fs.readFileSync(target, "utf-8");
  // Match `plugins:\n  enabled: [...]` (inline list) or `enabled:\n    - x\n    - y` (block).
  // Inline form: replace with block form including openwolf.
  const inlineRe = /(plugins:\s*\n\s+enabled:\s*)(\[[^\]]*\])/;
  const blockRe = /(plugins:\s*\n\s+enabled:\s*\n)((?:\s+- .+\n)*)/;

  let next = text;
  const inlineMatch = text.match(inlineRe);
  if (inlineMatch) {
    let list: string[] = [];
    try {
      list = JSON.parse(inlineMatch[2].replace(/'/g, '"'));
    } catch {
      // best-effort parse: strip brackets, split commas
      list = inlineMatch[2]
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    if (!list.includes(PLUGIN_NAME)) list.push(PLUGIN_NAME);
    const block = list.map((p) => `    - ${p}`).join("\n");
    next = text.replace(inlineRe, `$1\n${block}\n`);
  } else {
    const blockMatch = text.match(blockRe);
    if (blockMatch) {
      const lines = blockMatch[2];
      if (!lines.includes(`- ${PLUGIN_NAME}\n`)) {
        next = text.replace(blockRe, `$1$2    - ${PLUGIN_NAME}\n`);
      }
    } else {
      // No plugins block at all — append one
      next = text.trimEnd() + `\nplugins:\n  enabled:\n    - ${PLUGIN_NAME}\n`;
    }
  }
  fs.writeFileSync(target, next, "utf-8");
}

function patchConfigYamlDisable(): void {
  const target = configYaml();
  if (!fs.existsSync(target)) return;
  const text = fs.readFileSync(target, "utf-8");
  // Remove `    - openwolf` line from block form, or strip from inline list.
  const blockLineRe = new RegExp(`\\s+- ${PLUGIN_NAME}\\s*\\n`, "g");
  let next = text.replace(blockLineRe, "\n");
  // Inline form: remove "openwolf" from list
  next = next.replace(
    /(plugins:\s*\n\s+enabled:\s*\[)([^\]]*)\]/,
    (_m, head, body) => {
      const items = body
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s: string) => s && s !== PLUGIN_NAME);
      const inline = items.length ? `["${items.join('", "')}"]` : "[]";
      return `${head.replace(/\[$/, "")}${inline}`;
    },
  );
  fs.writeFileSync(target, next, "utf-8");
}

export class HermesAdapter implements AgentAdapter {
  readonly name = "hermes" as const;
  readonly projectDirEnvVar = "";

  detect(): boolean {
    return fs.existsSync(configDir()) && which("hermes") !== null;
  }

  async installGlobal(_opts: InstallOpts): Promise<void> {
    if (!this.detect()) {
      throw new Error(
        `Hermes not detected (~/.hermes missing or 'hermes' not in PATH).`,
      );
    }
    const venvPy = findHermesVenvPython();
    if (!venvPy) {
      throw new Error(
        `Could not locate Hermes' Python venv. Is hermes installed via the standard installer?`,
      );
    }
    const uv = uvBin();
    if (!uv) {
      throw new Error(
        `'uv' binary not found in PATH. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh`,
      );
    }

    const srcDir = pluginSourceDir();
    // uv pip install --python <venv-py> -e <plugin-source>
    execSync(
      `${uv} pip install --python ${JSON.stringify(venvPy)} -e ${JSON.stringify(srcDir)}`,
      { stdio: "inherit" },
    );

    patchConfigYamlEnable();
  }

  async uninstallGlobal(): Promise<void> {
    const venvPy = findHermesVenvPython();
    const uv = uvBin();
    if (venvPy && uv) {
      try {
        execSync(
          `${uv} pip uninstall --python ${JSON.stringify(venvPy)} openwolf-hermes`,
          { stdio: "inherit" },
        );
      } catch {
        // ignore — package may not be installed
      }
    }
    patchConfigYamlDisable();
  }

  parseHookInput(stdin: string): NormalizedHookInput {
    // Hermes hooks fire in-process (Python plugin), not via stdin/stdout.
    // This method exists for interface completeness; not called in normal flow.
    const raw = JSON.parse(stdin) as { tool_input?: { command?: string } };
    return { tool: "shell", command: raw.tool_input?.command, raw };
  }

  emitHookOutput(decision: HookDecision): string {
    const out: Record<string, unknown> = {
      decision: decision.allow ? "allow" : "deny",
    };
    if (decision.allow && decision.updatedCommand) {
      out.hookSpecificOutput = {
        tool_input: { command: decision.updatedCommand },
      };
    }
    return JSON.stringify(out);
  }
}
