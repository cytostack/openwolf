<!-- openwolf:start -->
## OpenWolf Protocol (active when project has `.wolf/`)

If the current working directory contains a `.wolf/` directory, this project
uses **OpenWolf** for context management. Apply these rules every session:

1. **Before reading any project file** — check `.wolf/anatomy.md` first. If
   the file is described there with a token estimate, prefer that summary
   over a full read.
2. **Before generating code** — check `.wolf/cerebrum.md` for user
   preferences, learnings, and the `## Do-Not-Repeat` list. Respect every
   entry.
3. **Before fixing a bug** — search `.wolf/buglog.json` for known fixes.
4. **After file changes** — update `.wolf/anatomy.md` (descriptions and
   token estimates) and append to `.wolf/memory.md`.
5. **After user corrections** — update `.wolf/cerebrum.md` immediately
   under Preferences / Learnings / Do-Not-Repeat as appropriate.
6. **After bug fixes** — log to `.wolf/buglog.json` with `error_message`,
   `root_cause`, `fix`, and `tags`.
7. **Token discipline** — never re-read a file you already read this
   session. Prefer anatomy summaries over full content.

If `.wolf/OPENWOLF.md` exists, it is the authoritative protocol — read it
once at session start and follow it strictly.

> **Note for non-Claude agents**: OpenWolf hooks (auto-injection, repeat
> detection, post-write anatomy refresh) only run on Claude Code. On this
> agent you must apply the protocol manually by reading the `.wolf/` files
> as described above.
<!-- openwolf:end -->
