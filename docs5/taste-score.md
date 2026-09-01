# OpenWolf Dashboard Taste Score

> 一个**可复现、可竞争**的 dashboard 品控分数。它把「感觉好不好看」翻译成能被脚本逐条检测的信号——两个 agent 在相同代码上跑出相同分数，没有"我觉得好看"的余地。

## 怎么跑

```bash
node scripts/taste-score.mjs             # 人类可读报告
node scripts/taste-score.mjs --json      # 机器可读 {score, dims}
node scripts/taste-score.mjs --dir <p>   # 扫别的 dashboard
```

## 分数构成（权重合计 100）

| 维度 | 权重 | 检查什么 | 标准 |
|---|---|---|---|
| Accessibility | 25 | `:focus-visible` ring、无裸 `focus:outline-none`、aria-label、aria-expanded、`prefers-reduced-motion` | focus 可见 / 键盘可达 / 屏幕阅读器可读 |
| Color Line | 20 | 组件内无硬编码 hex、无裸 `rgba(220,38,38)`、无 stray `#e5484d`、subtle 用 `color-mix` | 单色 + 单 signal-red，红色只表 live/attention/over-limit |
| Consistency | 20 | 无 emoji 图标、卡片统一 `.wd-card` 半径、`--danger-subtle` 统一、mono 纪律 | 一个色板、一套图标、一种半径 |
| Component DRY | 15 | 搜索框走 `SearchInput`、accordion 走 `CollapseCard`、表格走 `WdTable`（≤1 原生 table） | 消灭 ×5/×4/×3 手写样板 |
| State Coverage | 10 | 空态走 `EmptyState`、有骨架加载、有 error boundary | 空/加载/错误三态都有 |
| Craft | 10 | 无 per-frame `onMouseEnter`（用 CSS `:hover`）、无死 variant、语义化 `h1/h2` | hover 不写 JS、无死代码 |

每个维度内的检查项有固定分值（见 `scripts/taste-score.mjs` 的 `check` 定义）。**扣分项会逐条列出**，agent 直接照做即可加分。

## 当前基线：78/100

```
Accessibility    20/25   ← 1 处 focus:outline-none 漏网
Color Line       20/20   ✅ 满
Consistency      20/20   ✅ 满
Component DRY     5/15   ← 最大拉分空间
State Coverage    7/10   ← 缺 error boundary
Craft             6/10   ← onMouseEnter ×11
```

**为什么有扣分**：
- Component DRY 5/15：4 个 accordion 没用 `CollapseCard`（只 MemoryViewer 用了），3 张 table 没抽 `WdTable`。
- Craft 6/10：11 处 `onMouseEnter` 手写 hover（应改 CSS `.wd-row:hover`/`.wd-collapse-head:hover`）。
- Accessibility 20/25：1 处 `focus:outline-none`（某 panel 漏改）。
- State 7/10：无 error boundary。

## 从 78 拉到 100 的路线（按「好改 → 难」排）

1. **A11y +1 分（易）**：修掉最后 1 处 `focus:outline-none`（grep 找到它，改成依赖全局 `:focus-visible`）。
2. **Craft +4 分（易）**：11 处 `onMouseEnter` 全改 CSS hover——新建 `.wd-row:hover`（已有）应用到所有表格行 + accordion 头。顺手删 StatTile 死 `variant="outline"`。
3. **Component DRY +10 分（中）**：抽 `WdTable` 组件（TokenUsage/MemoryViewer/CronStatus 三张表统一），把剩下 3 个 accordion 换成 `CollapseCard`（CerebrumViewer/BugLog/CronStatus）。
4. **State +3 分（中）**：加一个 `ErrorBoundary` 包装 panel。

做完 1-4 即 100/100。**每个维度上限 100 分封顶**，越晚越难，因为边际收益递减。

## 多 agent 竞争机制（night-run）

分数让"品味"变成可竞争的指标。每个 agent 的迭代规则：

1. `git worktree` 隔离出一个分支。
2. `node scripts/taste-score.mjs --json` 拿当前基线。
3. 按扣分项改（**一次只攻一个维度**，不改别的，避免分数混乱）。
4. 再跑 `--json`，**分数必须严格大于改动前**才算成功，否则回滚。
5. 提交 + 报告「改了什么加分、改后分数」。

**编排建议**（cron night-run）：
```yaml
# 每夜：派 N 个 agent，各攻一个维度，谁的分数净增最高谁留下
taste-compete:
  schedule: "0 3 * * *"
  action: ai_task
  params:
    human_gate: []          # 竞争可无人值守
    timeout_ms: 3600000
    prompt: >
      对 src/dashboard/app/ 做一轮 Dashboards Taste Competition。
      跑 node scripts/taste-score.mjs --json 拿当前分数，只攻一个
      扣分最多的维度（不要动其他维度），改完再跑分数，
      分数净增 > 0 才提交。报告：改了什么、分数从 X 变 Y。
```

**门槛**：`.github/workflows/test.yml` 可加一个 taste-score 门槛（如 `< 90` 标橙、`< 100` 提示），让 CI 也用它卡回归。

## 原则

- 分数是**下限信号**，不是完美标准——它抓的是"执行层不塌方"，抓不到"这个设计超凡脱俗"。专家品味（构图、层次、气质）仍需人看。
- **红线上限**：这个 dashboard 的 monochrome + 单 signal-red + dot-matrix 识别度是资产，任何改动不得破坏它（Color Line 维度守住这条）。
- 竞争是**同向加码**，不是互相拆台——只允许加分改动，不允许"为了分数好看而删有意义的检查"。
