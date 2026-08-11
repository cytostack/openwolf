<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useData } from "vitepress";

const { isDark } = useData();
const copied = ref(false);
const mounted = ref(false);

function copyInstall() {
  navigator.clipboard.writeText("npm install -g openwolf");
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

let observer: IntersectionObserver | null = null;

onMounted(() => {
  mounted.value = true;
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer?.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );
  document
    .querySelectorAll(".reveal")
    .forEach((el) => observer?.observe(el));
});

onUnmounted(() => observer?.disconnect());

const features = [
  {
    icon: "grid",
    title: "Every Agent, One Brain",
    desc: "Codex, OpenCode, and Claude Code share one project memory, with Cursor and Antigravity in beta. init auto-detects what you have installed and wires it. Learn once, apply everywhere.",
    accent: "var(--ow-accent)",
  },
  {
    icon: "chart",
    title: "Measured Tokens",
    desc: "Real usage is read from harness transcripts at session end: input, output, cache, per agent. openwolf report shows measured numbers next to the estimates. Verify, don't trust.",
    accent: "#818cf8",
  },
  {
    icon: "loop",
    title: "Context That Survives",
    desc: "A token-budgeted digest of your project's state is injected at every session start. Compaction is snapshotted and restored. Sessions stop starting from zero.",
    accent: "#f472b6",
  },
  {
    icon: "bolt",
    title: "Symbol-Level Reads",
    desc: "Big files index their functions and classes with line ranges. Agents fetch one function with offset/limit instead of the whole file. Stale ranges are suppressed automatically.",
    accent: "#fbbf24",
  },
  {
    icon: "lightbulb",
    title: "Self-Learning",
    desc: "Every correction gets logged. Every bug fix gets remembered. Every preference gets enforced. Your agents get smarter with every session, without you repeating yourself.",
    accent: "#fb923c",
  },
  {
    icon: "eye",
    title: "Secure by Default",
    desc: "Loopback-only dashboard with token auth, zero shell interpolation, path traversal guards, and secret files excluded from every index. Plus bundled /security-audit and /reframe skills.",
    accent: "#38bdf8",
  },
];

const hooks = [
  { event: "SessionStart", script: "session-start.js", desc: "Injects the budgeted context digest, detects stale anatomy" },
  { event: "PreToolUse", script: "pre-read.js", desc: "Warns on repeated reads, shows anatomy and symbol hints" },
  { event: "PreToolUse", script: "pre-write.js", desc: "Checks cerebrum Do-Not-Repeat patterns" },
  { event: "PostToolUse", script: "post-read.js", desc: "Estimates and records token usage" },
  { event: "PostToolUse", script: "post-write.js", desc: "Updates the anatomy store under a cross-process lock" },
  { event: "PreCompact", script: "precompact.js", desc: "Snapshots session state before context compaction" },
  { event: "Stop", script: "stop.js", desc: "Reads measured usage from the transcript; surfaces end-of-turn reminders" },
];

const archFiles = [
  { name: "anatomy-index.json", desc: "Durable project index: descriptions, token estimates, content hashes, and per-file symbols. Rendered to anatomy.md.", icon: "file" },
  { name: "cerebrum.md", desc: "Learned preferences, conventions, Do-Not-Repeat mistakes. Gets smarter every session.", icon: "brain" },
  { name: "STATUS.md", desc: "Session handoff. The next session reaches productive context in one small read.", icon: "clock" },
  { name: "buglog.json", desc: "Bug encounter and resolution memory. Searchable. Prevents re-discovering the same fix.", icon: "bug" },
  { name: "hooks/", desc: "7 Node.js lifecycle hooks shared by all wired agents. Pure file I/O, no network, no AI calls.", icon: "code" },
  { name: "token-ledger.json", desc: "Estimated and measured usage per session and per agent, straight from harness transcripts.", icon: "gear" },
];
</script>

<template>
  <div class="ow-landing">

    <!-- ============================================================ -->
    <!-- HERO                                                         -->
    <!-- ============================================================ -->
    <section class="ow-hero">
      <!-- Background layers -->
      <div class="ow-hero__bg">
        <div class="ow-hero__grid"></div>
        <div class="ow-hero__glow ow-hero__glow--1"></div>
        <div class="ow-hero__glow ow-hero__glow--2"></div>
        <div class="ow-hero__fade"></div>
      </div>

      <div class="ow-hero__content" :class="{ 'is-mounted': mounted }">
        <div class="ow-hero__layout">

          <!-- Left -->
          <div class="ow-hero__copy">
            <h1 class="ow-hero__title">
              A second brain for Claude Code.
              <span class="ow-hero__title-accent">Now for every AI coding assistant.</span>
            </h1>

            <p class="ow-hero__desc">
              Coding agents re-read files they already saw, scan whole directories to find one function, and forget your conventions between sessions. OpenWolf gives Codex, OpenCode, Claude Code, and other agentic systems one persistent project brain: improved context management, optimized architecture scaffolding, and smarter token utilization. No workflow changes.
            </p>

            <div class="ow-hero__actions">
              <a href="/getting-started" class="ow-btn ow-btn--primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a0c12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                Get Started
              </a>
              <a href="/how-it-works" class="ow-btn ow-btn--ghost">
                How It Works
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </a>
            </div>

            <button @click="copyInstall" class="ow-install">
              <span class="ow-install__prompt">$</span>
              <code class="ow-install__cmd">npm install -g openwolf</code>
              <span class="ow-install__icon">
                <svg v-if="!copied" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ow-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              </span>
            </button>
          </div>

          <!-- Right: Terminal -->
          <div class="ow-hero__terminal-wrap">
            <div class="ow-terminal">
              <div class="ow-terminal__bar">
                <span class="ow-terminal__dot ow-terminal__dot--red"></span>
                <span class="ow-terminal__dot ow-terminal__dot--yellow"></span>
                <span class="ow-terminal__dot ow-terminal__dot--green"></span>
                <span class="ow-terminal__bar-title">terminal</span>
              </div>
              <div class="ow-terminal__body">
                <div class="ow-terminal__line"><span class="ow-terminal__ps">$</span> <span class="ow-terminal__cmd">openwolf init</span></div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> Agents detected: codex, gemini (auto-wiring)</div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> Codex hooks registered (.codex/hooks.json)</div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> Skills installed: /security-audit, /reframe</div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> OpenWolf v2.0.0 initialized</div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> Claude Code hooks registered (7 hooks)</div>
                <div class="ow-terminal__line ow-terminal__line--out"><span class="ow-terminal__ok">✓</span> Anatomy scan: 24 files indexed</div>
                <div class="ow-terminal__line ow-terminal__line--hint">You're ready. Use your agents as normal. OpenWolf is watching.</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <div class="ow-hero__scroll">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- WHY OPENWOLF                                                 -->
    <!-- ============================================================ -->
    <section class="ow-section ow-section--alt ow-why">
      <div class="ow-container ow-container--narrow">
        <div class="ow-why__content reveal">
          <h2 class="ow-why__title">Coding agents are powerful. But they work blind.</h2>
          <p class="ow-why__text">
            An agent does not know what a file contains until it opens it. It cannot tell a 50-token config from a 2,000-token module. It reads the same file three times in one session without noticing. It has no map of your project, no memory of past corrections, no awareness of what it already tried.
          </p>
          <p class="ow-why__text">
            OpenWolf gives every agent a project index, a learning memory, and a token-aware read layer. And in 2.0 it measures real usage from harness transcripts, so the savings are verified rather than estimated.
          </p>
          <div class="ow-why__stats">
            <div class="ow-why__stat">
              <span class="ow-why__stat-num">~66%</span>
              <span class="ow-why__stat-label">average estimated token reduction (1.x field use)</span>
            </div>
            <div class="ow-why__stat">
              <span class="ow-why__stat-num">71%</span>
              <span class="ow-why__stat-label">repeated reads caught</span>
            </div>
            <div class="ow-why__stat">
              <span class="ow-why__stat-num">2M+</span>
              <span class="ow-why__stat-label">tokens saved</span>
            </div>
          </div>

          <!-- Token comparison -->
          <div class="ow-why__comparison">
            <h3 class="ow-why__comparison-title">Same project. Same prompts. Different setups.</h3>
            <div class="ow-why__bar-group">
              <div class="ow-why__bar-row">
                <span class="ow-why__bar-label">Bare agent (no OpenWolf)</span>
                <div class="ow-why__bar-track">
                  <div class="ow-why__bar ow-why__bar--yellow" style="width: 100%"></div>
                </div>
                <span class="ow-why__bar-val">~2.5M</span>
              </div>
              <div class="ow-why__bar-row">
                <span class="ow-why__bar-label">Same project with OpenWolf</span>
                <div class="ow-why__bar-track">
                  <div class="ow-why__bar ow-why__bar--green" style="width: 17%"></div>
                </div>
                <span class="ow-why__bar-val">~425K</span>
              </div>
            </div>
            <p class="ow-why__bar-note">Heuristic estimates from 1.x field use. OpenWolf 2.0 measures your own numbers from harness transcripts: run openwolf report.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- FEATURES                                                     -->
    <!-- ============================================================ -->
    <section class="ow-section">
      <div class="ow-container">
        <div class="ow-section__header reveal">
          <span class="ow-label">Features</span>
          <h2 class="ow-heading">Everything works invisibly</h2>
          <p class="ow-subheading">OpenWolf hooks into your agent's lifecycle. No commands to remember. It just makes every session smarter.</p>
        </div>

        <div class="ow-features-grid">
          <div v-for="(f, i) in features" :key="i"
               class="ow-card reveal"
               :style="{ '--card-accent': f.accent, transitionDelay: (i * 60) + 'ms' }">
            <div class="ow-card__icon">
              <!-- lightbulb -->
              <svg v-if="f.icon === 'lightbulb'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/><path d="M10 21h4M12 17v4"/></svg>
              <!-- chart -->
              <svg v-if="f.icon === 'chart'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
              <!-- bolt -->
              <svg v-if="f.icon === 'bolt'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              <!-- loop -->
              <svg v-if="f.icon === 'loop'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <!-- eye -->
              <svg v-if="f.icon === 'eye'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <!-- grid -->
              <svg v-if="f.icon === 'grid'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </div>
            <h3 class="ow-card__title">{{ f.title }}</h3>
            <p class="ow-card__desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- HOW IT WORKS                                                 -->
    <!-- ============================================================ -->
    <section class="ow-section">
      <div class="ow-container ow-container--narrow">
        <div class="ow-section__header reveal">
          <span class="ow-label ow-label--secondary">How It Works</span>
          <h2 class="ow-heading">Three steps. Then invisible.</h2>
        </div>

        <div class="ow-steps">
          <div class="ow-step reveal">
            <div class="ow-step__num">01</div>
            <div class="ow-step__content">
              <h3 class="ow-step__title">Initialize</h3>
              <p class="ow-step__desc">Run one command in any project. Creates <code>.wolf/</code> directory, registers hooks, scans all files.</p>
              <div class="ow-step__cmd"><span class="ow-step__ps">$</span> openwolf init</div>
            </div>
          </div>

          <div class="ow-step reveal" style="transition-delay: 100ms">
            <div class="ow-step__num">02</div>
            <div class="ow-step__content">
              <h3 class="ow-step__title">Work Normally</h3>
              <p class="ow-step__desc">Just use <code>claude</code> as you always do. Hooks fire invisibly, tracking, learning, enforcing. You don't interact with any of it.</p>
              <div class="ow-step__cmd"><span class="ow-step__ps">$</span> claude</div>
            </div>
          </div>

          <div class="ow-step reveal" style="transition-delay: 200ms">
            <div class="ow-step__num">03</div>
            <div class="ow-step__content">
              <h3 class="ow-step__title">Get Smarter</h3>
              <p class="ow-step__desc">Every session, OpenWolf learns preferences, logs bugs, prevents repeated mistakes. View everything on the real-time dashboard.</p>
              <div class="ow-step__cmd"><span class="ow-step__ps">$</span> openwolf dashboard</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- ARCHITECTURE                                                 -->
    <!-- ============================================================ -->
    <section class="ow-section ow-section--alt">
      <div class="ow-container">
        <div class="ow-section__header reveal">
          <span class="ow-label ow-label--accent">Architecture</span>
          <h2 class="ow-heading">The <code class="ow-heading__code">.wolf/</code> directory</h2>
          <p class="ow-subheading">Every project gets a <code>.wolf/</code> folder containing state, learning memory, and configuration. Markdown is the source of truth.</p>
        </div>

        <div class="ow-arch-grid">
          <div v-for="(f, i) in archFiles" :key="i"
               class="ow-arch-card reveal"
               :style="{ transitionDelay: (i * 50) + 'ms' }">
            <h4 class="ow-arch-card__name">{{ f.name }}</h4>
            <p class="ow-arch-card__desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- HOOKS PIPELINE                                               -->
    <!-- ============================================================ -->
    <section class="ow-section">
      <div class="ow-container ow-container--narrow">
        <div class="ow-section__header reveal">
          <span class="ow-label ow-label--warn">Hooks</span>
          <h2 class="ow-heading">The enforcement layer</h2>
          <p class="ow-subheading">Seven hooks fire on every agent action. They warn but never block. Pure Node.js. No network, no AI, no extra cost.</p>
        </div>

        <div class="ow-hooks reveal">
          <div v-for="(h, i) in hooks" :key="i" class="ow-hook">
            <span class="ow-hook__event">{{ h.event }}</span>
            <span class="ow-hook__arrow">→</span>
            <span class="ow-hook__script">{{ h.script }}</span>
            <span class="ow-hook__desc">{{ h.desc }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- CTA                                                          -->
    <!-- ============================================================ -->
    <section class="ow-section ow-cta">
      <div class="ow-container ow-container--narrow reveal">
        <h2 class="ow-heading" style="text-align: center">Make your coding agent smarter</h2>
        <p class="ow-subheading" style="text-align: center">One install. One init. Then it's invisible.</p>

        <div class="ow-cta__actions">
          <a href="/getting-started" class="ow-btn ow-btn--primary ow-btn--lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a0c12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            Get Started
          </a>
          <a href="https://github.com/cytostack/openwolf" target="_blank" class="ow-btn ow-btn--ghost ow-btn--lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            GitHub
          </a>
        </div>
      </div>
    </section>

    <!-- ============================================================ -->
    <!-- FOOTER                                                       -->
    <!-- ============================================================ -->
    <footer class="ow-footer">
      <div class="ow-container">
        <div class="ow-footer__grid">

          <div class="ow-footer__brand">
            <div class="ow-footer__logo">
              <img src="/wolf.svg" alt="OpenWolf" width="24" height="24" />
              <span class="ow-footer__name">OpenWolf</span>
            </div>
            <p class="ow-footer__tagline">A second brain for AI coding agents.<br />Created by Dr. Farhan Palathinkal at <a href="https://github.com/cytostack" target="_blank" class="ow-footer__link">Cytostack</a>.</p>
          </div>

          <div class="ow-footer__col">
            <h4 class="ow-footer__col-title">Product</h4>
            <a href="/getting-started" class="ow-footer__link">Getting Started</a>
            <a href="/how-it-works" class="ow-footer__link">How It Works</a>
            <a href="/commands" class="ow-footer__link">Commands</a>
            <a href="/dashboard" class="ow-footer__link">Dashboard</a>
          </div>

          <div class="ow-footer__col">
            <h4 class="ow-footer__col-title">Features</h4>
            <a href="/hooks" class="ow-footer__link">Hooks</a>
            <a href="/reframe" class="ow-footer__link">Reframe</a>
            <a href="/configuration" class="ow-footer__link">Configuration</a>
          </div>

          <div class="ow-footer__col">
            <h4 class="ow-footer__col-title">Community</h4>
            <a href="https://github.com/cytostack/openwolf" target="_blank" class="ow-footer__link">GitHub</a>
            <a href="https://github.com/cytostack/openwolf/issues" target="_blank" class="ow-footer__link">Report a Bug</a>
            <a href="https://www.npmjs.com/package/openwolf" target="_blank" class="ow-footer__link">npm</a>
          </div>

        </div>

        <div class="ow-footer__bottom">
          <p>AGPL-3.0 · Copyright 2026 Cytostack Pvt Ltd</p>
          <p>Node.js 20+ · Windows, macOS, Linux</p>
        </div>
      </div>
    </footer>

  </div>
</template>

<style>
/* ================================================================
   OPENWOLF LANDING: CUSTOM CSS (no DaisyUI dependency)
   Works with VitePress light/dark via CSS custom properties
   ================================================================ */

.ow-landing {
  font-family: "Inter", system-ui, -apple-system, sans-serif;
  color: var(--ow-text-primary);
  -webkit-font-smoothing: antialiased;
}

/* Reset VitePress overrides inside landing */
.ow-landing a { color: inherit; text-decoration: none; }
.ow-landing h1, .ow-landing h2, .ow-landing h3, .ow-landing h4 {
  border: none; margin: 0; padding: 0;
}
.ow-landing code {
  background: none; color: inherit; font-size: inherit;
}

/* ---- Layout ---- */
.ow-container { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.ow-container--narrow { max-width: 800px; }
.ow-section { padding: 96px 0; background: var(--ow-bg-deep); }
.ow-section--alt { background: var(--ow-bg-surface); }

/* ---- Section header ---- */
.ow-section__header { text-align: center !important; margin-bottom: 56px; }
.ow-section__header * { text-align: center !important; }
.ow-section__header p { text-align: center !important; }
.ow-label {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ow-accent);
  border: 1px solid var(--ow-accent);
  border-radius: 100px;
  padding: 4px 14px;
  margin-bottom: 20px;
}
.ow-label--secondary { color: #818cf8; border-color: #818cf8; }
.ow-label--accent { color: var(--ow-accent); border-color: var(--ow-accent); }
.ow-label--warn { color: #fbbf24; border-color: #fbbf24; }
.ow-heading {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: var(--ow-text-primary);
  text-align: center;
}
.ow-heading__code {
  font-family: "JetBrains Mono", monospace;
  color: var(--ow-accent);
}
.ow-subheading {
  margin-top: 16px !important;
  font-size: 1.05rem !important;
  line-height: 1.65 !important;
  color: var(--ow-text-secondary) !important;
  max-width: 520px !important;
  margin-left: auto !important;
  margin-right: auto !important;
  text-align: center !important;
}

/* ================================================================
   HERO
   ================================================================ */
.ow-hero {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--ow-bg-deep);
}

/* Background */
.ow-hero__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ow-hero__grid {
  position: absolute;
  inset: 0;
  opacity: 0.04;
  background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
  background-size: 32px 32px;
}
.ow-hero__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
}
.ow-hero__glow--1 {
  top: -15%;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  height: 500px;
  background: var(--ow-accent-glow);
  animation: pulse-slow 6s ease-in-out infinite;
}
.ow-hero__glow--2 {
  top: 15%;
  right: -5%;
  width: 300px;
  height: 300px;
  background: rgba(129, 140, 248, 0.06);
  animation: pulse-slow 6s ease-in-out 3s infinite;
}
.ow-hero__fade {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 70% 50% at 50% 40%, transparent 0%, var(--ow-bg-deep) 100%);
}

@keyframes pulse-slow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Content */
.ow-hero__content {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 112px 24px 80px;
}
.ow-hero__layout {
  display: flex;
  flex-direction: column;
  gap: 48px;
}
@media (min-width: 960px) {
  .ow-hero__layout {
    flex-direction: row;
    align-items: center;
    gap: 64px;
  }
}

/* Copy */
.ow-hero__copy {
  flex: 1;
  max-width: 540px;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}
.is-mounted .ow-hero__copy {
  opacity: 1;
  transform: translateY(0);
}

.ow-hero__badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 100px;
  border: 1px solid var(--ow-border);
  background: var(--ow-accent-soft);
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ow-text-muted);
  margin-bottom: 28px;
}
.ow-hero__badge-dot {
  position: relative;
  display: flex;
  width: 6px;
  height: 6px;
}
.ow-hero__badge-ping {
  position: absolute;
  display: inline-flex;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--ow-accent);
  opacity: 0.75;
  animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.ow-hero__badge-core {
  position: relative;
  display: inline-flex;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ow-accent);
}
@keyframes ping {
  75%, 100% { transform: scale(2.5); opacity: 0; }
}

.ow-hero__title {
  font-size: clamp(2.25rem, 5.5vw, 3.75rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.035em;
  color: var(--ow-text-primary);
}
.ow-hero__title-accent {
  display: block;
  color: var(--ow-accent);
}

.ow-hero__desc {
  margin-top: 24px;
  font-size: 1.05rem;
  line-height: 1.65;
  color: var(--ow-text-secondary);
  max-width: 440px;
}
.ow-hero__desc strong {
  color: var(--ow-text-primary);
  font-weight: 600;
}

/* Buttons */
.ow-hero__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
}

.ow-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  text-decoration: none !important;
}
.ow-btn--primary {
  background: var(--ow-accent);
  color: #0a0c12 !important;
  box-shadow: 0 4px 14px var(--ow-accent-glow);
}
.ow-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px var(--ow-accent-glow);
}
.ow-btn--ghost {
  background: transparent;
  color: var(--ow-text-secondary);
  border: 1px solid var(--ow-border);
}
.ow-btn--ghost:hover {
  color: var(--ow-text-primary);
  border-color: var(--ow-border-hover);
  background: var(--ow-accent-soft);
}
.ow-btn--lg {
  padding: 14px 28px;
  font-size: 15px;
  border-radius: 12px;
}

/* Install line */
.ow-install {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  padding: 12px 20px;
  border-radius: 12px;
  border: 1px solid var(--ow-border);
  background: var(--ow-accent-soft);
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.ow-install:hover {
  border-color: var(--ow-accent);
  background: var(--ow-accent-soft);
}
.ow-install__prompt {
  color: var(--ow-accent);
  font-weight: 700;
}
.ow-install__cmd {
  color: var(--ow-text-secondary);
}
.ow-install__icon {
  color: var(--ow-text-faint);
  display: flex;
}

/* Terminal */
.ow-hero__terminal-wrap {
  flex: 1;
  max-width: 480px;
  width: 100%;
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.9s ease 0.15s, transform 0.9s ease 0.15s;
}
.is-mounted .ow-hero__terminal-wrap {
  opacity: 1;
  transform: translateY(0);
}

.ow-terminal {
  border-radius: 16px;
  border: 1px solid var(--ow-border);
  background: var(--ow-terminal-bg);
  box-shadow: 0 20px 50px rgba(0,0,0,0.3);
  overflow: hidden;
}
.ow-terminal__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.ow-terminal__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.ow-terminal__dot--red { background: #ff5f57; }
.ow-terminal__dot--yellow { background: #febc2e; }
.ow-terminal__dot--green { background: #28c840; }
.ow-terminal__bar-title {
  margin-left: 8px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  color: rgba(255,255,255,0.25);
  letter-spacing: 0.04em;
}
.ow-terminal__body {
  padding: 20px;
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  line-height: 1.9;
}
.ow-terminal__ps {
  color: var(--ow-terminal-prompt);
  font-weight: 700;
}
.ow-terminal__cmd {
  color: #e8eaf0;
}
.ow-terminal__line--out {
  color: var(--ow-terminal-text);
}
.ow-terminal__ok {
  color: var(--ow-terminal-success);
}
.ow-terminal__line--hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--ow-terminal-muted);
}
.ow-terminal__hl {
  color: rgba(52, 211, 153, 0.5);
}

/* Scroll hint */
.ow-hero__scroll {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  color: var(--ow-text-faint);
  animation: bounce 2s infinite;
}
@keyframes bounce {
  0%, 20%, 50%, 80%, 100% { transform: translateX(-50%) translateY(0); }
  40% { transform: translateX(-50%) translateY(-8px); }
  60% { transform: translateX(-50%) translateY(-4px); }
}

/* ================================================================
   WHY OPENWOLF
   ================================================================ */
.ow-why__content {
  max-width: 640px;
  margin: 0 auto;
}
.ow-why__title {
  font-size: clamp(1.5rem, 3.5vw, 2rem) !important;
  font-weight: 800 !important;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--ow-text-primary);
  margin-bottom: 24px !important;
  text-align: left !important;
}
.ow-why__text {
  font-size: 1.05rem !important;
  line-height: 1.7 !important;
  color: var(--ow-text-secondary) !important;
  margin-bottom: 16px !important;
  text-align: left !important;
}
.ow-why__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
  margin-top: 36px;
  padding-top: 32px;
  border-top: 1px solid var(--ow-border);
}
.ow-why__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ow-why__stat-num {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ow-accent);
  line-height: 1;
}
.ow-why__stat-label {
  font-size: 13px;
  color: var(--ow-text-muted);
  letter-spacing: 0.01em;
}

/* Comparison bars */
.ow-why__comparison {
  margin-top: 40px;
  padding-top: 32px;
  border-top: 1px solid var(--ow-border);
}
.ow-why__comparison-title {
  font-size: 14px !important;
  font-weight: 600;
  color: var(--ow-text-secondary);
  margin-bottom: 20px !important;
  text-align: left !important;
}
.ow-why__bar-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ow-why__bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ow-why__bar-label {
  font-size: 12px;
  color: var(--ow-text-muted);
  min-width: 160px;
  flex-shrink: 0;
  text-align: right;
}
@media (max-width: 640px) {
  .ow-why__bar-label { min-width: 100px; font-size: 11px; }
}
.ow-why__bar-track {
  flex: 1;
  height: 24px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  overflow: hidden;
}
.ow-why__bar {
  height: 100%;
  border-radius: 6px;
  transition: width 1s ease;
}
.ow-why__bar--red { background: #f472b6; }
.ow-why__bar--yellow { background: #fbbf24; }
.ow-why__bar--green { background: var(--ow-accent); }
.ow-why__bar-val {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--ow-text-secondary);
  min-width: 48px;
}
.ow-why__bar-note {
  margin-top: 12px !important;
  font-size: 11px !important;
  color: var(--ow-text-faint) !important;
  text-align: left !important;
}

/* ================================================================
   FEATURES GRID
   ================================================================ */
.ow-features-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 640px) { .ow-features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 960px) { .ow-features-grid { grid-template-columns: repeat(3, 1fr); } }

.ow-card {
  padding: 28px;
  border-radius: 14px;
  border: 1px solid var(--ow-border);
  background: var(--ow-bg-deep);
  box-shadow: var(--ow-card-shadow);
  transition: all 0.3s ease;
}
.ow-card:hover {
  border-color: var(--card-accent, var(--ow-accent));
  box-shadow: var(--ow-card-shadow-hover);
  transform: translateY(-2px);
}
.ow-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  background: color-mix(in srgb, var(--card-accent, var(--ow-accent)) 10%, transparent);
  color: var(--card-accent, var(--ow-accent));
  transition: background 0.2s;
}
.ow-card:hover .ow-card__icon {
  background: color-mix(in srgb, var(--card-accent, var(--ow-accent)) 18%, transparent);
}
.ow-card__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ow-text-primary);
  margin-bottom: 8px;
}
.ow-card__desc {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--ow-text-secondary);
}

/* ================================================================
   STEPS
   ================================================================ */
.ow-steps { display: flex; flex-direction: column; gap: 16px; }
.ow-step {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 28px;
  border-radius: 14px;
  border: 1px solid var(--ow-border);
  background: var(--ow-bg-surface);
  transition: border-color 0.3s;
}
@media (min-width: 640px) {
  .ow-step { flex-direction: row; gap: 24px; align-items: flex-start; }
}
.ow-step:hover { border-color: var(--ow-border-hover); }
.ow-step__num {
  font-size: 40px;
  font-weight: 900;
  color: var(--ow-text-faint);
  line-height: 1;
  letter-spacing: -0.04em;
  flex-shrink: 0;
  opacity: 0.5;
}
.ow-step__content { flex: 1; min-width: 0; }
.ow-step__title {
  font-size: 17px;
  font-weight: 700;
  color: var(--ow-text-primary);
  margin-bottom: 6px;
}
.ow-step__desc {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--ow-text-secondary);
  margin-bottom: 14px;
}
.ow-step__desc code {
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  background: var(--ow-accent-soft) !important;
  color: var(--ow-accent) !important;
  padding: 2px 6px;
  border-radius: 4px;
}
.ow-step__cmd {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  color: var(--ow-text-secondary);
  background: var(--ow-bg-deep);
  padding: 8px 16px;
  border-radius: 10px;
}
.ow-step__ps {
  color: var(--ow-accent);
  font-weight: 700;
}

/* ================================================================
   ARCHITECTURE GRID
   ================================================================ */
.ow-arch-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
@media (min-width: 640px) { .ow-arch-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 960px) { .ow-arch-grid { grid-template-columns: repeat(3, 1fr); } }

.ow-arch-card {
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--ow-border);
  background: var(--ow-bg-deep);
  transition: border-color 0.3s;
}
.ow-arch-card:hover { border-color: var(--ow-border-hover); }
.ow-arch-card__name {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 700;
  color: var(--ow-accent);
  margin-bottom: 8px;
}
.ow-arch-card__desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--ow-text-muted);
}

/* ================================================================
   HOOKS
   ================================================================ */
.ow-hooks { display: flex; flex-direction: column; gap: 8px; }
.ow-hook {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 18px;
  border-radius: 10px;
  border: 1px solid var(--ow-border);
  background: var(--ow-bg-surface);
  transition: border-color 0.3s;
}
@media (min-width: 640px) {
  .ow-hook {
    flex-direction: row;
    align-items: center;
    gap: 14px;
  }
}
.ow-hook:hover { border-color: var(--ow-border-hover); }
.ow-hook__event {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ow-accent);
  border: 1px solid var(--ow-accent);
  border-radius: 6px;
  padding: 3px 10px;
  flex-shrink: 0;
}
.ow-hook__arrow {
  display: none;
  color: var(--ow-text-faint);
}
@media (min-width: 640px) { .ow-hook__arrow { display: block; } }
.ow-hook__script {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  color: var(--ow-text-primary);
  flex-shrink: 0;
  min-width: 140px;
}
.ow-hook__desc {
  font-size: 13px;
  color: var(--ow-text-muted);
}

/* ================================================================
   CTA
   ================================================================ */
.ow-cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 36px;
}

/* ================================================================
   FOOTER
   ================================================================ */
.ow-footer {
  background: var(--ow-bg-surface);
  border-top: 1px solid var(--ow-border);
  padding: 56px 0 40px;
}
.ow-footer__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 36px;
}
@media (min-width: 640px) {
  .ow-footer__grid {
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: 40px;
  }
}
.ow-footer__brand { max-width: 280px; }
.ow-footer__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.ow-footer__name {
  font-size: 16px;
  font-weight: 700;
  color: var(--ow-text-primary);
  letter-spacing: -0.02em;
}
.ow-footer__tagline {
  font-size: 13px;
  line-height: 1.6;
  color: var(--ow-text-muted);
}
.ow-footer__col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ow-footer__col-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ow-text-secondary);
  margin-bottom: 4px;
}
.ow-footer__link {
  font-size: 13px;
  color: var(--ow-text-muted) !important;
  text-decoration: none !important;
  transition: color 0.2s;
}
.ow-footer__link:hover {
  color: var(--ow-accent) !important;
}
.ow-footer__bottom {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--ow-border);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}
.ow-footer__bottom p {
  font-size: 12px;
  color: var(--ow-text-faint);
  margin: 0;
}

/* ================================================================
   SCROLL REVEAL
   ================================================================ */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.55s cubic-bezier(0.25, 1, 0.5, 1);
}
.reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}
</style>
