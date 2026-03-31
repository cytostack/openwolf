import { useState, useEffect, useRef } from "react";
import type { Theme } from "../../hooks/useTheme.js";

interface Project { root: string; name: string; }

interface HeaderProps {
  title: string;
  theme: Theme;
  onToggleTheme: () => void;
  currentProject: string;
}

export function Header({ title, theme, onToggleTheme, currentProject }: HeaderProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(() => {});
  }, []);

  // Reset switching state when the project actually changes
  useEffect(() => {
    setSwitching(false);
  }, [currentProject]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const switchProject = (root: string) => {
    if (root === currentProject || switching) return;
    setSwitching(true);
    setOpen(false);
    fetch("/api/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root }) })
      .catch(() => setSwitching(false));
  };

  const otherProjects = projects.filter(p => p.root !== currentProject);

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{title}</h1>
        {otherProjects.length > 0 && (
          <div className="relative" ref={ref}>
            <button
              onClick={() => setOpen(o => !o)}
              disabled={switching}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", color: switching ? "var(--text-faint)" : "var(--text-muted)" }}
            >
              {switching ? "Switching…" : currentProject}
              {!switching && <span style={{ color: "var(--text-faint)" }}>▾</span>}
            </button>
            {open && (
              <div className="absolute left-0 mt-1 rounded-xl overflow-hidden z-50 min-w-48"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
                <div className="px-3 py-2 text-xs" style={{ color: "var(--text-faint)", borderBottom: "1px solid var(--border-subtle)" }}>Switch project</div>
                {otherProjects.map(p => (
                  <button key={p.root} onClick={() => switchProject(p.root)}
                    className="w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-(--bg-surface-hover)"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {p.name}
                    <span className="block text-xs truncate" style={{ color: "var(--text-faint)" }}>{p.root}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleTheme}
          className="md:hidden p-2 rounded-md transition-colors text-sm"
          style={{ color: "var(--text-muted)" }}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </div>
  );
}
