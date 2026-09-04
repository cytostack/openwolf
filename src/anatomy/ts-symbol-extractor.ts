import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { SymbolEntry } from "../hooks/anatomy-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tree-sitter symbol extraction (Workstream J2). Scanner/daemon-side ONLY:
// hooks ship dependency-free into .wolf/hooks/ and keep the regex extractor
// as their incremental fast path; a full `openwolf scan` upgrades entries with
// exact AST-derived line ranges, nested-symbol awareness, and signature
// skeletons for large files.
//
// Uses web-tree-sitter + prebuilt grammars from tree-sitter-wasms (both MIT),
// loaded lazily so CLI startup never pays for them. Every entry point returns
// null when wasm/grammar loading fails, and callers fall back to the regex
// extractor — tree-sitter is an upgrade, never a requirement.
// ─────────────────────────────────────────────────────────────────────────────

const LANG_WASM: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".php": "php",
};

interface LangSpec {
  /** Top-level (or namespace-level) node types mapped to symbol kinds. */
  types: Record<string, SymbolEntry["kind"]>;
  /** Node types whose bodies are scanned one level deep for methods. */
  containers: string[];
  /** Node types inside containers that count as methods. */
  methodTypes: string[];
}

const TS_JS_SPEC: LangSpec = {
  types: {
    function_declaration: "fn",
    generator_function_declaration: "fn",
    class_declaration: "class",
    abstract_class_declaration: "class",
    interface_declaration: "section",
    enum_declaration: "section",
    type_alias_declaration: "section",
    lexical_declaration: "fn", // kept only when it declares an arrow function (see below)
    variable_declaration: "fn",
  },
  containers: ["class_declaration", "abstract_class_declaration"],
  methodTypes: ["method_definition"],
};

const LANG_SPECS: Record<string, LangSpec> = {
  typescript: TS_JS_SPEC,
  tsx: TS_JS_SPEC,
  javascript: TS_JS_SPEC,
  python: {
    types: { function_definition: "fn", decorated_definition: "fn", class_definition: "class" },
    containers: ["class_definition", "decorated_definition"],
    methodTypes: ["function_definition"],
  },
  go: {
    types: { function_declaration: "fn", method_declaration: "method", type_declaration: "class" },
    containers: [],
    methodTypes: [],
  },
  rust: {
    types: { function_item: "fn", struct_item: "class", enum_item: "class", trait_item: "section", impl_item: "section", mod_item: "section" },
    containers: ["impl_item", "trait_item"],
    methodTypes: ["function_item"],
  },
  java: {
    types: { class_declaration: "class", interface_declaration: "section", enum_declaration: "section", record_declaration: "class" },
    containers: ["class_declaration", "record_declaration", "interface_declaration"],
    methodTypes: ["method_declaration", "constructor_declaration"],
  },
  ruby: {
    types: { method: "fn", class: "class", module: "section" },
    containers: ["class", "module"],
    methodTypes: ["method", "singleton_method"],
  },
  php: {
    types: { function_definition: "fn", class_declaration: "class", interface_declaration: "section", trait_declaration: "section" },
    containers: ["class_declaration", "trait_declaration"],
    methodTypes: ["method_declaration"],
  },
};

/** Cap symbols per file, matching the regex extractor's cap. */
const MAX_SYMBOLS = 30;
/** Never parse more than this much content. */
const MAX_BYTES = 512 * 1024;
/** Skeleton budget in estimated tokens (~3.5 chars/tok). */
const SKELETON_MAX_TOKENS = 400;

export function tsSymbolsSupported(ext: string): boolean {
  return ext.toLowerCase() in LANG_WASM;
}

// Lazily initialized parser machinery, cached per process.
let initFailed = false;
let ParserCtor: any = null;
let LanguageCtor: any = null;
const languageCache = new Map<string, any>();
let wasmDir: string | null = null;

async function ensureInit(): Promise<boolean> {
  if (initFailed) return false;
  if (ParserCtor) return true;
  try {
    const mod: any = await import("web-tree-sitter");
    // Module shape varies by version: 0.24 (CJS) exports Parser as default
    // with Language attached to it; 0.25+ (ESM) exports both named.
    ParserCtor = mod.Parser ?? mod.default?.Parser ?? mod.default;
    await ParserCtor.init();
    LanguageCtor = mod.Language ?? mod.default?.Language ?? ParserCtor.Language;
    if (!LanguageCtor) throw new Error("web-tree-sitter Language export not found");
    const require = createRequire(import.meta.url);
    wasmDir = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
    return true;
  } catch {
    initFailed = true;
    return false;
  }
}

async function loadLanguage(langName: string): Promise<any | null> {
  if (languageCache.has(langName)) return languageCache.get(langName);
  try {
    const wasmPath = path.join(wasmDir!, `tree-sitter-${langName}.wasm`);
    if (!fs.existsSync(wasmPath)) throw new Error("grammar missing");
    const lang = await LanguageCtor.load(wasmPath);
    languageCache.set(langName, lang);
    return lang;
  } catch {
    languageCache.set(langName, null);
    return null;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function nodeName(node: any): string {
  const nameNode = node.childForFieldName?.("name");
  if (nameNode?.text) return nameNode.text;
  // lexical/variable declarations: name lives on the declarator.
  for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === "variable_declarator" || child.type === "type_spec") {
      const inner = child.childForFieldName?.("name");
      if (inner?.text) return inner.text;
    }
    if (child.type === "identifier" || child.type === "type_identifier" || child.type === "constant") {
      return child.text;
    }
  }
  return "";
}

/** For lexical declarations, only arrow/function initializers count as symbols. */
function declaresFunction(node: any): boolean {
  if (node.type !== "lexical_declaration" && node.type !== "variable_declaration") return true;
  const text: string = node.text ?? "";
  const firstLine = text.split("\n", 1)[0];
  return /=>|\bfunction\b/.test(firstLine) || /=\s*(?:async\s*)?\($/.test(firstLine.trim()) || /=>/.test(text.split("\n").slice(0, 2).join("\n"));
}

export interface FileAnalysis {
  symbols: SymbolEntry[];
  /** Signature-only outline (repomix-style), capped to ~400 tokens. */
  skeleton?: string;
}

/**
 * Parse a file with tree-sitter and return exact symbols plus a signature
 * skeleton. Returns null when the grammar or runtime is unavailable — the
 * caller keeps its regex-extracted symbols.
 */
export async function analyzeFileTS(content: string, ext: string): Promise<FileAnalysis | null> {
  const langName = LANG_WASM[ext.toLowerCase()];
  if (!langName || Buffer.byteLength(content, "utf-8") > MAX_BYTES) return null;
  if (!(await ensureInit())) return null;
  const language = await loadLanguage(langName);
  if (!language) return null;

  let tree: any;
  try {
    const parser = new ParserCtor();
    parser.setLanguage(language);
    tree = parser.parse(content);
  } catch {
    return null;
  }
  if (!tree?.rootNode) return null;

  const spec = LANG_SPECS[langName];
  const symbols: SymbolEntry[] = [];
  const signatureLines: string[] = [];
  const lines = content.split("\n");

  const pushSymbol = (node: any, kind: SymbolEntry["kind"], namePrefix = "") => {
    const name = nodeName(node);
    if (!name) return;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const slice = lines.slice(startLine - 1, endLine).join("\n");
    symbols.push({
      name: namePrefix ? `${namePrefix}.${name}` : name,
      kind,
      startLine,
      endLine,
      tokens: estimateTokens(slice),
    });
    signatureLines.push(lines[startLine - 1].trimEnd());
  };

  const root = tree.rootNode;
  const walkChildren = (parent: any) => {
    for (let i = 0; i < parent.namedChildCount; i++) {
      if (symbols.length >= MAX_SYMBOLS) return;
      const node = parent.namedChild(i);
      if (!node) continue;
      let kind = spec.types[node.type];
      // Python decorated defs wrap the real definition one level down.
      let target = node;
      if (node.type === "decorated_definition") {
        const inner = node.childForFieldName?.("definition") ?? node.namedChild(node.namedChildCount - 1);
        if (inner) {
          target = inner;
          kind = spec.types[inner.type];
        }
      }
      if (kind && declaresFunction(target)) {
        pushSymbol(target, kind);
        if (spec.containers.includes(target.type)) {
          const body = target.childForFieldName?.("body");
          if (body) {
            const containerName = nodeName(target);
            for (let j = 0; j < body.namedChildCount; j++) {
              if (symbols.length >= MAX_SYMBOLS) return;
              const member = body.namedChild(j);
              if (member && spec.methodTypes.includes(member.type)) {
                pushSymbol(member, "method", containerName);
              }
            }
          }
        }
      } else if (node.type === "export_statement") {
        // TS/JS: exported declarations nest one level down. export_statement
        // never nests another export_statement, so recursion terminates.
        walkChildren(node);
      }
    }
  };
  walkChildren(root);

  if (symbols.length === 0) return { symbols: [] };

  let skeleton = signatureLines.join("\n");
  while (estimateTokens(skeleton) > SKELETON_MAX_TOKENS && signatureLines.length > 1) {
    signatureLines.pop();
    skeleton = signatureLines.join("\n");
  }

  return { symbols, skeleton: skeleton || undefined };
}
