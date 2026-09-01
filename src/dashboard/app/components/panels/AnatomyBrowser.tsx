import React, { useState, useMemo } from "react";
import { TokenBadge } from "../shared/TokenBadge.js";
import type { WolfData } from "../../hooks/useWolfData.js";
import { SearchInput } from "../shared/SearchInput.js";
import { EmptyState } from "../shared/EmptyState.js";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  files: Array<{ file: string; description: string; tokens: number; symbols?: Array<{ name: string; kind: string; startLine: number; endLine: number; tokens: number }> }>;
}

function buildTree(entries: WolfData["anatomy"]["entries"]): TreeNode {
  const root: TreeNode = { name: ".", path: ".", children: [], files: [] };
  const sectionMap = new Map<string, TreeNode>();
  sectionMap.set("./", root);

  for (const entry of entries) {
    const section = entry.section;
    if (!sectionMap.has(section)) {
      const parts = section.replace(/\/$/, "").split("/");
      let current = root;
      let currentPath = "";
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const key = `${currentPath}/`;
        if (!sectionMap.has(key)) {
          const node: TreeNode = { name: part, path: key, children: [], files: [] };
          current.children.push(node);
          sectionMap.set(key, node);
        }
        current = sectionMap.get(key)!;
      }
    }
    sectionMap.get(section)!.files.push({ file: entry.file, description: entry.description, tokens: entry.tokens, symbols: entry.symbols });
  }

  return root;
}

function DirNode({ node, search, depth = 0 }: { node: TreeNode; search: string; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const lower = search.toLowerCase();
  const matchedFiles = node.files.filter((f) =>
    !search || f.file.toLowerCase().includes(lower) || f.description.toLowerCase().includes(lower)
  );
  const hasMatchingChildren = node.children.some((c) => hasMatches(c, lower));

  if (search && matchedFiles.length === 0 && !hasMatchingChildren) return null;

  return (
    <div className="ml-3">
      {node.name !== "." && (
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 py-1 text-sm transition-colors text-secondary">
          <span className="w-4 text-center text-faint">{expanded ? "▼" : "▶"}</span>
          <span className="text-muted">▸</span>
          <span>{node.name}/</span>
          <span className="text-xs text-faint">{countFiles(node)} files</span>
        </button>
      )}
      {(expanded || node.name === ".") && (
        <div className={node.name !== "." ? "ml-4" : ""}>
          {matchedFiles.sort((a, b) => a.file.localeCompare(b.file)).map((f) => (
            <div key={f.file} className="py-1 pl-5">
              <div className="flex items-center gap-2">
                <span className="text-faint">▪</span>
                <span className="text-sm font-mono text-primary">{f.file}</span>
                {f.description && <span className="text-xs truncate max-w-xs text-faint">— {f.description}</span>}
                <TokenBadge tokens={f.tokens} className="ml-auto shrink-0" />
              </div>
              {f.symbols && f.symbols.length > 0 && (
                <div className="pl-6 pt-0.5 flex flex-wrap gap-x-3">
                  {f.symbols.slice(0, 8).map((s) => (
                    <span key={`${s.name}-${s.startLine}`} className="wd-label text-faint" style={{ fontSize: "0.6rem" }}>
                      {s.kind} {s.name} L{s.startLine}-{s.endLine}
                    </span>
                  ))}
                  {f.symbols.length > 8 && (
                    <span className="wd-label text-faint" style={{ fontSize: "0.6rem" }}>+{f.symbols.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {node.children.sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
            <DirNode key={child.path} node={child} search={search} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function countFiles(node: TreeNode): number {
  return node.files.length + node.children.reduce((sum, c) => sum + countFiles(c), 0);
}

function hasMatches(node: TreeNode, search: string): boolean {
  if (node.files.some((f) => f.file.toLowerCase().includes(search) || f.description.toLowerCase().includes(search))) return true;
  return node.children.some((c) => hasMatches(c, search));
}

export function AnatomyBrowser({ data }: { data: WolfData }) {
  const { anatomy } = data;
  const [search, setSearch] = useState("");
  const [sortBySize, setSortBySize] = useState(false);

  const tree = useMemo(() => buildTree(anatomy.entries), [anatomy.entries]);

  const stats = useMemo(() => {
    const tokens = anatomy.entries.map((e) => e.tokens);
    return {
      total: anatomy.entries.length,
      avg: tokens.length > 0 ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0,
      largest: tokens.length > 0 ? Math.max(...tokens) : 0,
    };
  }, [anatomy.entries]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search files..." ariaLabel="Search files" />
        <button onClick={() => setSortBySize(!sortBySize)} className="px-3 py-2 text-xs rounded-lg wd-panel-muted">
          {sortBySize ? "Sort: Size" : "Sort: A-Z"}
        </button>
      </div>

      <div className="flex gap-4 mb-4 text-sm text-muted">
        <span>{stats.total} files tracked</span>
        <span>Avg: {stats.avg} tok/file</span>
        <span>Largest: {stats.largest} tok</span>
      </div>

      <div className="rounded-xl p-4 wd-panel">
        {anatomy.entries.length === 0 ? (
          <EmptyState icon="◇" title="No anatomy data"
            description="Run openwolf scan to index your project." />
        ) : (
          <DirNode node={tree} search={search} />
        )}
      </div>
    </div>
  );
}
