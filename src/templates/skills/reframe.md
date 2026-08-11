---
description: OpenWolf's design brain — pick/migrate UI frameworks or audit/fix UI against the anti-generic design principles
argument-hint: [migrate [framework] | audit [target] | fix [target]]
---

Arguments: $ARGUMENTS

Read `.wolf/reframe-frameworks.md` first — it contains the **Design Principles
(anti-generic mandate)**, the framework knowledge base, and the migration prompts.
Use `.wolf/anatomy.md` to locate UI files instead of scanning.

Pick the mode from the arguments (default: `migrate` if a framework is named or the
user is choosing one; otherwise ask which mode they want):

## Mode: migrate [framework]
Framework selection and migration.
1. If no framework is named, ask the Decision Questions from the knowledge file
   (stop early once the answer narrows to 1–2 options) and recommend one.
2. Use that framework's prompt from the knowledge file, adapted to this project's
   real structure via `.wolf/anatomy.md`.
3. The Design Principles override anything generic in the prompt: no template
   hero→features→CTA structures, no stock palettes — distinctive by default.

## Mode: audit [target]
Walk the target (default: the whole UI) and flag every match against the AI-tell
blocklist in the Design Principles: purple gradient heroes, glassmorphism-everything,
emoji headings, generic 3-column feature grids, stock Tailwind palette, Inter for
every role, template SaaS structure, filler microcopy. Produce a findings table —
component, tell matched, severity, specific replacement direction — and end with the
3 changes that would most increase distinctiveness.

## Mode: fix [target]
Run the audit, then fix findings in severity order. Fixes must move toward, not merely
away: typography chosen with intent, a palette derived from the product's actual
brand/domain, asymmetry where it serves hierarchy, copy specific to what the product
does, density appropriate to the audience. Preserve the existing framework and
component APIs — this is a design pass, not a rewrite. After each fix, state what
changed and why it reads as designed-on-purpose.

Acceptance criterion for every mode: **if the result could be swapped onto any other
product without anyone noticing, it fails.**
