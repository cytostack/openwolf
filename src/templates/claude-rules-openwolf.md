---
description: OpenWolf protocol enforcement, active on all files
globs: **/*
---

- To locate a symbol or file, run `openwolf find <name>` first (ranked shortlist, under 1k tokens). For one file's description and symbol ranges: `openwolf find --file <path>`. Never read .wolf/anatomy.md whole; it is an index.
- Check .wolf/cerebrum.md Do-Not-Repeat list before generating code (grep "## Do-Not-Repeat"); after a user correction, update cerebrum.md immediately.
- Do NOT manually update .wolf/anatomy.md or .wolf/memory.md; the OpenWolf hooks maintain them.
- BEFORE fixing any bug: run `openwolf bug search "<error>"` or grep .wolf/buglog.json. AFTER fixing one: log it there (error_message, root_cause, fix, tags).
- When resuming a session, read .wolf/STATUS.md first; regenerate it with /handoff when a quest finishes.
