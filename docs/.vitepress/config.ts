import { defineConfig } from "vitepress";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  title: "OpenWolf",
  description:
    "A second brain for AI coding agents. Context management, architecture scaffolding, and smarter token utilization through invisible hooks. Works with Codex, OpenCode, Claude Code, and more.",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/wolf.svg" }],
    ["link", { rel: "canonical", href: "https://openwolf.com" }],
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
    ["meta", { property: "og:url", content: "https://openwolf.com" }],
    ["meta", { property: "og:site_name", content: "OpenWolf" }],
    [
      "meta",
      {
        property: "og:title",
        content: "OpenWolf: A Second Brain for AI Coding Agents",
      },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Open-source hooks that give AI coding agents project intelligence, verifiable token measurement, and mistake prevention. Works with Codex, OpenCode, Claude Code, and more.",
      },
    ],
    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      {
        name: "twitter:title",
        content: "OpenWolf: A Second Brain for AI Coding Agents",
      },
    ],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "Open-source hooks that give AI coding agents project intelligence, verifiable token measurement, and mistake prevention. Works with Codex, OpenCode, Claude Code, and more.",
      },
    ],
    // Additional SEO
    ["meta", { name: "author", content: "Dr. Farhan Palathinkal, Cytostack" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "ai coding agents, codex, opencode, claude code, cursor, antigravity, context management, token tracking, agent memory, token optimization, open source, developer tools",
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
      { icon: "github", link: "https://github.com/cytostack/openwolf" },
    ],
    footer: {
      message: 'AGPL-3.0 · Made by <a href="https://github.com/cytostack" target="_blank">Cytostack</a>',
      copyright: 'Copyright 2026 Cytostack Pvt Ltd',
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
