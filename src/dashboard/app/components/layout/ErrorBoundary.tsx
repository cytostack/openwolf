import React from "react";

interface Props {
  /** Panel name, shown so the user knows which tile failed. */
  label: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps one malformed state file from blanking the whole dashboard.
 *
 * The panels read .wolf/*.json straight from disk, and a hand-edited file can
 * carry any shape at all. Before this, a buglog written as a bare array made
 * ProjectOverview throw on its first render and the entire page went white
 * with only a console trace to go on. Now the failing panel degrades to a
 * readable card and every other panel stays reachable.
 *
 * Mount with key={activePanel} so navigating away clears the error.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[openwolf] panel "${this.props.label}" crashed:`, error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="wd-card p-8">
        <div className="dot-display text-2xl mb-3" style={{ color: "var(--accent)" }}>PANEL FAILED</div>
        <p className="mb-3" style={{ color: "var(--text-primary)" }}>
          The <span className="font-mono">{this.props.label}</span> panel could not render.
        </p>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          This usually means a file in <span className="font-mono">.wolf/</span> holds a shape the
          dashboard did not expect. Every other panel still works. Run{" "}
          <span className="font-mono" style={{ color: "var(--text-secondary)" }}>openwolf status</span> to
          check the project state files.
        </p>
        <pre
          className="text-xs rounded-lg p-3 overflow-x-auto font-mono"
          style={{ color: "var(--accent)", background: "var(--accent-subtle)" }}
        >{error.message}</pre>
      </div>
    );
  }
}
