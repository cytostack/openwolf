import { defineConfig } from "vitepress";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/openwolf/",
  title: "OpenWolf",
  description:
    "openwolf keeps one project memory across Claude Code, Codex and OpenCode, and measures what each session actually cost. Local, open source, no API calls.",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/openwolf/wolf.svg" }],
    ["link", { rel: "canonical", href: "https://nottyjay.github.io/openwolf/" }],
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
    ],
    [
      "link",
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "",
      },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
    // Open Graph
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:url", content: "https://nottyjay.github.io/openwolf/" }],
    ["meta", { property: "og:site_name", content: "OpenWolf" }],
    [
      "meta",
      {
        property: "og:title",
        content: "OpenWolf: portable project memory and measured token usage for coding agents",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "openwolf keeps one project memory across Claude Code, Codex and OpenCode, and measures what each session actually cost. Local, open source, no API calls.",
      },
    ],
    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      {
        name: "twitter:title",
        content: "OpenWolf: portable project memory and measured token usage for coding agents",
      },
    ],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "openwolf keeps one project memory across Claude Code, Codex and OpenCode, and measures what each session actually cost. Local, open source, no API calls.",
      },
    ],
    // Additional SEO
    ["meta", { name: "author", content: "Cytostack (original) / alptech (fork)" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "project memory, agent memory, context engineering, claude code, codex, opencode, cursor, gemini cli, antigravity, token usage, token tracking, context management, open source, developer tools",
      },
    ],
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  themeConfig: {
    logo: "/wolf.svg",
    siteTitle: "OpenWolf",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "How It Works", link: "/how-it-works" },
      { text: "Commands", link: "/commands" },
      { text: "Config", link: "/configuration" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is OpenWolf?", link: "/" },
          { text: "Getting Started", link: "/getting-started" },
        ],
      },
      {
        text: "Core Concepts",
        items: [
          { text: "How It Works", link: "/how-it-works" },
          { text: "Hooks", link: "/hooks" },
          { text: "Dashboard", link: "/dashboard" },
        ],
      },
      {
        text: "Features",
        items: [
          { text: "Reframe", link: "/reframe" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Commands", link: "/commands" },
          { text: "Configuration", link: "/configuration" },
          { text: "Update & Restore", link: "/updating" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/nottyjay/openwolf" },
    ],
    footer: {
      message: 'AGPL-3.0 · Original by <a href="https://github.com/cytostack" target="_blank">Cytostack</a> · Fork maintained by <a href="https://github.com/nottyjay" target="_blank">alptech</a>',
      copyright: 'Copyright 2026 Cytostack Pvt Ltd / alptech',
    },
    search: {
      provider: "local",
    },
  },
  appearance: "dark",
  markdown: {
    lineNumbers: false,
  },
});
