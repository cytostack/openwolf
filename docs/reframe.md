# Reframe

Curated knowledge base of 13 modern UI frameworks with battle-tested prompts. Reframe ships as a `/reframe` slash command and a reference file your agent reads to guide framework selection and migration. Every prompt enforces an anti-generic design mandate so the result does not look AI-generated.

## Overview

When you run `/reframe` or ask your agent to change, pick, or migrate your UI framework, it reads `.wolf/reframe-frameworks.md` (installed during `openwolf init`). The file contains decision criteria, framework profiles, and framework-specific prompts that your agent adapts to your project using the anatomy index.

Run `/reframe migrate`, `/reframe audit`, or `/reframe fix`, or simply talk to your agent about your UI framework and Reframe activates automatically.

---

## How It Works

1. `.wolf/reframe-frameworks.md` is created during `openwolf init`
2. When you run `/reframe` or mention changing a UI framework, your agent reads the file
3. Your agent asks **5 decision questions** to understand your priorities and constraints
4. Your agent recommends a framework based on your answers
5. Your agent uses the framework-specific prompt, adapted to your project via the anatomy index, to execute the installation and migration

The framework-specific prompts handle dependency installation, configuration, component patterns, and common migration steps. Your agent tailors them to your actual project structure.

---

## Supported Frameworks

Reframe includes profiles and prompts for 13 frameworks:

| Framework | Description |
|-----------|-------------|
| **shadcn/ui** | React + Tailwind + Radix. Gold standard for full applications. |
| **Aceternity UI** | Framer Motion animations. Cinematic landing pages and scroll effects. |
| **Magic UI** | Polished SaaS aesthetic. Linear/Vercel-inspired design language. |
| **DaisyUI** | Tailwind plugin. Fastest setup, works with any JavaScript framework. |
| **HeroUI** | React Aria foundation. Polished components with strong accessibility. |
| **Chakra UI** | CSS-in-JS. Robust theming system, excellent developer experience. |
| **Flowbite** | Tailwind plugin. Business and enterprise look out of the box. |
| **Preline UI** | Tailwind plugin. Speed-focused with pre-built page sections. |
| **Park UI** | Ark UI headless + Tailwind. Works across React, Vue, and Solid. |
| **Origin UI** | 400+ free shadcn-based components. Drop-in library for shadcn projects. |
| **Headless UI** | Zero styling, full design control. Unstyled accessible primitives. |
| **Cult UI** | AI-forward aesthetic. Full-stack patterns for modern AI applications. |
| **Astryx** | Meta's design system. 160+ themeable components, StyleX-authored, agent-ready docs. |

---

## Quick Selection Guide

Use this priority table to narrow the choice before reading full profiles:

| Priority | Best Fit |
|----------|----------|
| Full app with many forms, tables, layouts | shadcn/ui |
| Cinematic animations and landing pages | Aceternity UI |
| SaaS marketing site, polished and minimal | Magic UI |
| Fastest possible setup, any framework | DaisyUI |
| Accessibility is non-negotiable | HeroUI |
| Deep theming and design tokens | Chakra UI |
| Enterprise/business dashboard | Flowbite |
| Speed to production with pre-built sections | Preline UI |
| Multi-framework project (React + Vue) | Park UI |
| Already using shadcn, need more components | Origin UI |
| Full design control, no opinions | Headless UI |
| AI-native product aesthetic | Cult UI |
| Full design system + theming, agent-friendly docs | Astryx |

---

## Example Conversation

```
You:   /reframe migrate
Agent: [reads reframe-frameworks.md]
       What framework does your project currently use?
You:   React with plain Tailwind, no component library
Agent: What's your priority: animations, speed, control, or accessibility?
You:   Stunning animations for a landing page
Agent: I'd recommend Aceternity UI or Magic UI.
       Aceternity gives cinematic scroll effects with Framer Motion.
       Magic UI gives a polished SaaS look inspired by Linear and Vercel.
       Which direction fits better?
You:   Let's go with Aceternity
Agent: [uses Aceternity prompt, de-genericized per the design mandate]
       [installs dependencies]
       [refactors components with animation patterns]
```

Your agent handles the entire migration: installing packages, updating configs, converting components, and verifying the build still passes.

---

## Audit and fix modes

Beyond migration, `/reframe audit <target>` scans existing UI against the
anti-generic design mandate (purple gradient heroes, glassmorphism everywhere,
template feature grids, stock palettes, and other AI tells) and reports what to
change. `/reframe fix <target>` applies those fixes toward a distinctive result,
preserving your framework and component APIs. Distinctiveness is an acceptance
criterion: if the design could be swapped onto any other product without anyone
noticing, it fails.
