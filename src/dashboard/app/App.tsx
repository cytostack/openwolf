import React, { useState, Suspense, lazy } from "react";
import { TopNav } from "./components/layout/TopNav.js";
import { Layout } from "./components/layout/Layout.js";
import { useWolfData } from "./hooks/useWolfData.js";
import { useTheme } from "./hooks/useTheme.js";

const ProjectOverview = lazy(() => import("./components/panels/ProjectOverview.js").then(m => ({ default: m.ProjectOverview })));
const ActivityTimeline = lazy(() => import("./components/panels/ActivityTimeline.js").then(m => ({ default: m.ActivityTimeline })));
const TokenUsage = lazy(() => import("./components/panels/TokenUsage.js").then(m => ({ default: m.TokenUsage })));
const CronStatus = lazy(() => import("./components/panels/CronStatus.js").then(m => ({ default: m.CronStatus })));
const CerebrumViewer = lazy(() => import("./components/panels/CerebrumViewer.js").then(m => ({ default: m.CerebrumViewer })));
const MemoryViewer = lazy(() => import("./components/panels/MemoryViewer.js").then(m => ({ default: m.MemoryViewer })));
const AnatomyBrowser = lazy(() => import("./components/panels/AnatomyBrowser.js").then(m => ({ default: m.AnatomyBrowser })));
const BugLog = lazy(() => import("./components/panels/BugLog.js").then(m => ({ default: m.BugLog })));
const AISuggestions = lazy(() => import("./components/panels/AISuggestions.js").then(m => ({ default: m.AISuggestions })));

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 rounded-full w-48" style={{ background: "var(--bg-surface)" }} />
      <div className="h-40 wd-card" />
      <div className="grid grid-cols-3 gap-4">
        <div className="h-24 wd-card" />
        <div className="h-24 wd-card" />
        <div className="h-24 wd-card" />
      </div>
    </div>
  );
}

const PANELS = ["overview", "activity", "tokens", "cron", "cerebrum", "memory", "anatomy", "bugs", "suggestions"];

export default function App() {
  // Hash-based deep links: /#tokens opens the Tokens panel directly.
  const initial = location.hash.slice(1);
  const [activePanel, setActivePanelState] = useState(PANELS.includes(initial) ? initial : "overview");
  const setActivePanel = (p: string) => {
    setActivePanelState(p);
    history.replaceState(null, "", `#${p}`);
  };
  const data = useWolfData();
  const { theme, toggleTheme } = useTheme();

  if (data.loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--bg-base)" }}>
        <div className="text-center">
          <div className="dot-display text-3xl mb-3" style={{ color: "var(--text-primary)" }}>OPENWOLF</div>
          <p className="wd-label" style={{ color: "var(--text-muted)" }}>loading…</p>
        </div>
      </div>
    );
  }

  if (data.authError) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6" style={{ background: "var(--bg-base)" }}>
        <div className="wd-card p-8 max-w-lg text-center">
          <div className="dot-display text-3xl mb-3" style={{ color: "var(--accent)" }}>401</div>
          <p className="mb-3" style={{ color: "var(--text-primary)" }}>Dashboard token rejected.</p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            The server on this port belongs to a different project or an older session.
            Close this tab and relaunch with <span className="font-mono" style={{ color: "var(--text-secondary)" }}>openwolf dashboard</span> from
            your project to open the correct URL with a matching token.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <TopNav
        activePanel={activePanel}
        onNavigate={setActivePanel}
        daemonStatus={data.health.status}
        projectName={data.project.name || data.identity.name}
        agents={data.config.agents}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <Layout>
        <Suspense fallback={<Skeleton />}>
          {activePanel === "overview" && <ProjectOverview data={data} />}
          {activePanel === "activity" && <ActivityTimeline data={data} />}
          {activePanel === "tokens" && <TokenUsage data={data} />}
          {activePanel === "cron" && <CronStatus data={data} />}
          {activePanel === "cerebrum" && <CerebrumViewer data={data} />}
          {activePanel === "memory" && <MemoryViewer data={data} />}
          {activePanel === "anatomy" && <AnatomyBrowser data={data} />}
          {activePanel === "bugs" && <BugLog data={data} />}
          {activePanel === "suggestions" && <AISuggestions data={data} />}
        </Suspense>
      </Layout>
    </div>
  );
}
