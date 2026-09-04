Regenerate `.wolf/STATUS.md` as a session handoff document. $ARGUMENTS

Build it from the session's actual state, not from memory of the conversation alone:

1. Read the current `.wolf/STATUS.md` to preserve its structure and any still-relevant open items.
2. Run `git status --short` and `git log --oneline -8` to see what actually changed.
3. Skim the latest session block of `.wolf/memory.md` for the action log.

Then rewrite `.wolf/STATUS.md` with:

- `## ✅ Done` : what this session completed, one line each, concrete (files, features, fixes). Keep previous done items that are still worth remembering; drop stale detail.
- `## 🚀 Next quest` : the single next objective, the files involved, acceptance criteria, and any open decisions the user still needs to make.
- `## Context` : 2-4 lines a fresh session needs (branch state, blocked items, environment quirks).
- Bump the date.

Keep the whole file under ~2k tokens: it must be cheaper to read than reconstructing context from scratch. Do not pad it; a short honest handoff beats a complete-looking one.
