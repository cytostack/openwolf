import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface DetectedBrowser {
  path: string;
  name: string;
  source: "config" | "default-browser" | "known-path" | "path";
}

const CHROMIUM_RE = /(chrome|chromium|msedge|edge)/i;

function isChromiumName(candidate: string): boolean {
  return CHROMIUM_RE.test(candidate);
}

function isChromiumExecutable(exePath: string): boolean {
  if (!isChromiumName(path.basename(exePath))) return false;
  return isChromiumName(path.dirname(exePath));
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  } catch {
    return "";
  }
}

function parseWindowsCommand(regValue: string): string | null {
  const raw = regValue.trim();
  const quoted = raw.match(/^"([^"]+)"/);
  let exePath: string | null = null;
  if (quoted) {
    exePath = quoted[1];
  } else {
    const first = raw.split(/\s+/)[0];
    if (first && !/rundll32/i.test(first)) exePath = first;
  }
  if (!exePath || !isChromiumExecutable(exePath) || !exists(exePath)) return null;
  return exePath;
}

function windowsDefaultBrowser(): string | null {
  const userChoice = run("reg", [
    "query",
    `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice`,
    "/v",
    "ProgId",
  ]);
  const m = userChoice.match(/ProgId\s+REG_\w+\s+(\S+)/);
  if (!m) return null;
  const progId = m[1].trim();
  if (!isChromiumName(progId)) return null;
  const command = run("reg", ["query", `HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command`, "/ve"]);
  const cm = command.match(/REG_\w+\s+(.+)$/m);
  if (!cm) return null;
  return parseWindowsCommand(cm[1]);
}

function macDefaultBrowser(): string | null {
  const out = run("defaults", ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"]);
  const bundles = ["com.google.Chrome", "com.microsoft.edgemac", "com.brave.Browser", "org.chromium.Chromium"];
  const exeNames: Record<string, string> = {
    "com.google.Chrome": "Google Chrome",
    "com.microsoft.edgemac": "Microsoft Edge",
    "com.brave.Browser": "Brave Browser",
    "org.chromium.Chromium": "Chromium",
  };
  for (const bundle of bundles) {
    if (!out.includes(bundle)) continue;
    const found = run("mdfind", [`kMDItemCFBundleIdentifier == "${bundle}"`]).split("\n")[0].trim();
    if (!found) continue;
    const appPath = path.join(found, "Contents", "MacOS", exeNames[bundle]);
    if (exists(appPath)) return appPath;
  }
  return null;
}

function linuxDefaultBrowser(): string | null {
  const out = run("xdg-settings", ["get", "default-web-browser"]).trim();
  if (!out || !isChromiumName(out)) return null;
  const candidates = [
    out.replace(/\.desktop$/, ""),
    out.replace(/[^a-z]/gi, "").toLowerCase(),
  ];
  for (const c of candidates) {
    const p = run("which", [c]).split("\n")[0].trim();
    if (p && exists(p)) return p;
  }
  return null;
}

function knownPaths(): string[] {
  const paths: string[] = [];
  if (process.platform === "win32") {
    const dirs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
    for (const d of dirs) {
      paths.push(path.join(d, "Google", "Chrome", "Application", "chrome.exe"));
      paths.push(path.join(d, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (process.platform === "darwin") {
    paths.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    paths.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    paths.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium"
    );
  }
  return paths.filter(exists);
}

function pathLookup(): string | null {
  const cmd =
    process.platform === "win32" ? "where" : process.platform === "darwin" ? "which" : "which";
  const names =
    process.platform === "win32"
      ? ["chrome", "msedge", "chromium"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const name of names) {
    const p = run(cmd, [name]).split(/\r?\n/)[0].trim();
    if (p && exists(p)) return p;
  }
  return null;
}

/**
 * Find a usable Chromium-based browser for headless capture.
 * Priority: config chrome_path > OS default browser > known install paths > PATH.
 */
export function detectBrowser(chromePath?: string | null): DetectedBrowser | null {
  if (chromePath) {
    if (exists(chromePath)) {
      return { path: chromePath, name: path.basename(chromePath), source: "config" };
    }
  }

  let p: string | null = null;
  if (process.platform === "win32") p = windowsDefaultBrowser();
  else if (process.platform === "darwin") p = macDefaultBrowser();
  else p = linuxDefaultBrowser();
  if (p) return { path: p, name: path.basename(p), source: "default-browser" };

  for (const kp of knownPaths()) {
    return { path: kp, name: path.basename(kp), source: "known-path" };
  }

  const lp = pathLookup();
  if (lp) return { path: lp, name: path.basename(lp), source: "path" };

  return null;
}
