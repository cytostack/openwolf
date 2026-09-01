<!-- openwolf:begin -->
# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.

## Dashboard Taste Score

When touching `src/dashboard/app/`, run `node scripts/taste-score.mjs --json`. **The score is a non-decreasing gate for dashboard work** — never land a change that lowers it. Aim to raise it; it is the metric agents compete on overnight.

Dimensions (total 100): a11y 25 · color-line 20 · consistency 20 · component-DRY 15 · state 10 · craft 10. See `docs5/taste-score.md` for the 78→100 roadmap.

Hard rules kept by the scorer (do not regress them):

- **Identity**: keep the monochrome + single signal-red + dot-matrix look. Never add a second accent, an AI-purple gradient, or glassmorphism.
- **Shared components**: never hand-roll a search input / accordion / table — use `<SearchInput/>`, `<CollapseCard/>`, or extract a `<WdTable/>`.
- **No per-frame hover JS**: never write `onMouseEnter={…currentTarget.style…}` — use a `.wd-*:hover` CSS class.
- **A11y**: keep the `:focus-visible` ring, `aria-label` / `aria-expanded`, and `prefers-reduced-motion`.
- **States**: empty → `EmptyState`, loading → skeleton, errors → `ErrorBoundary`.
- **Score non-decreasing** vs the committed baseline.
<!-- openwolf:end -->
