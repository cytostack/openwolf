import React, { useState } from "react";
import type { WolfData } from "../../hooks/useWolfData.js";

export function DesignQC({ data }: { data: WolfData }) {
  const { designqcReport, project } = data;
  const [captureState, setCaptureState] = useState<"idle" | "running" | "error">("idle");
  const [captureError, setCaptureError] = useState<string | null>(null);

  const hasCaptures = designqcReport && designqcReport.captures && designqcReport.captures.length > 0;

  const runCapture = () => {
    setCaptureState("running");
    setCaptureError(null);
    fetch("/api/designqc/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: r.statusText }));
          throw new Error(body.error || r.statusText);
        }
        setCaptureState("idle");
      })
      .catch(err => {
        setCaptureState("error");
        setCaptureError(err.message);
      });
  };

  return (
    <div>
      {/* URL auto-detection note */}
      <div className="rounded-xl px-4 py-3 mb-6 flex items-start gap-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text-faint)", marginTop: 1 }}>ℹ</span>
        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
          Works with <span className="font-medium" style={{ color: "var(--text-secondary)" }}>any accessible URL</span> — local or deployed.
          The URL is auto-detected from <code className="px-1 rounded text-xs" style={{ background: "var(--bg-base)" }}>package.json</code> homepage, env files, or a running dev server.
          {project?.root && (
            <span> Scanning <code className="px-1 rounded text-xs" style={{ background: "var(--bg-base)" }}>{project.root}</code>.</span>
          )}
        </div>
      </div>

      {/* Run Capture */}
      <div className="rounded-xl p-5 mb-6" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium" style={{ color: "var(--text-secondary)" }}>Capture Screenshots</h3>
          <button
            onClick={runCapture}
            disabled={captureState === "running"}
            className="px-4 py-1.5 text-sm rounded-lg transition-colors"
            style={{
              background: captureState === "error" ? "var(--danger-subtle)" : "var(--accent-subtle)",
              border: `1px solid ${captureState === "error" ? "rgba(220,38,38,0.3)" : "var(--accent)"}`,
              color: captureState === "error" ? "var(--danger)" : "var(--accent)",
              opacity: captureState === "running" ? 0.6 : 1,
            }}
          >
            {captureState === "running" ? "Capturing…" : captureState === "error" ? "Retry Capture" : "Run Capture"}
          </button>
        </div>
        {captureState === "running" && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Auto-detecting URL, launching browser, capturing screenshots… this takes ~15–30s.
          </p>
        )}
        {captureState === "error" && captureError && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{captureError}</p>
        )}
        {captureState === "idle" && (
          <div className="space-y-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            <p>Detects your URL automatically from <code className="px-1 rounded text-xs" style={{ background: "var(--bg-base)" }}>package.json</code>, env files, or a running dev server.</p>
            <p>After capture, ask Claude: <span className="italic">"Read .wolf/designqc-captures/ and evaluate the design"</span></p>
          </div>
        )}
      </div>

      {/* Last Capture */}
      <div className="rounded-xl p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Last Capture</h3>
        {!hasCaptures ? (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No screenshots captured yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-4 text-sm mb-3">
              <span style={{ color: "var(--text-faint)" }}>
                Captured: {designqcReport.captured_at || "—"}
              </span>
              <span style={{ color: "var(--text-faint)" }}>
                Size: {designqcReport.total_size_kb || 0}KB
              </span>
              <span style={{ color: "var(--text-faint)" }}>
                Est. tokens: ~{designqcReport.estimated_tokens || 0}
              </span>
            </div>
            {designqcReport.captures.map((cap: any, i: number) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "var(--bg-base)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{cap.file}</span>
                <span className="text-xs" style={{ color: "var(--text-faint)" }}>{cap.viewport} &middot; {cap.route}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
