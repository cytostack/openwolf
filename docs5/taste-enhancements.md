# OpenWolf Dashboard 品质增强 100 条（P0→P1→P2，web design taste 视角）

> 依据：`src/dashboard/app/` 现状事实探查（含 `文件:行号` 锚点）+ taste 标准（a11y、一致性、状态呈现、数据密度、avoid AI-tells）。
> **红线**：保留现有「monochrome + 单 signal-red + dot-matrix 点阵数字 + Space Grotesk」识别度，不改成紫渐变/玻璃拟态/居中三卡这些 AI default。
> 编号 D1-D100 是稳定索引。状态：P0 / P1 / P2。

---

## A. 可访问性（a11y）—— 现状最薄，P0 最密

D1. **全局 focus-visible ring**：`globals.css` 加 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`。现状 0 条 focus 规则。〔P0〕
D2. **移除 5 处 `focus:outline-none` 无替代**：`ActivityTimeline.tsx:46`、`AnatomyBrowser.tsx:123`、`CerebrumViewer.tsx:22`、`BugLog.tsx:41`、`MemoryViewer.tsx:22` —— 全部 `outline-none` 但无 focus-visible 替代环，键盘焦点不可见。改成统一 `.wd-input` 组件 + focus ring。〔P0〕
D3. **TopNav wordmark 加 aria-label**：`TopNav.tsx:33` 纯图标按钮无标签。〔P0〕
D4. **agent 圆点加 aria-label**：`TopNav.tsx:46`（agent 状态圆点）无 label，屏幕阅读器无法读出。〔P0〕
D5. **可折叠面板头加 `aria-expanded` + `aria-controls`**：MemoryViewer/CerebrumViewer/BugLog/CronStatus 的 ▶/▼ 头按钮全是纯字形。用一个共享 `CollapseCard` 组件带 aria。〔P0〕
D6. **搜索框加 `aria-label`**（5 处）：`ActivityTimeline.tsx:45`、`AnatomyBrowser.tsx:122`、`CerebrumViewer.tsx:21`、`BugLog.tsx:40`、`MemoryViewer.tsx:21` —— 占位符不算 label。〔P0〕
D7. **`<table>` 加 `<caption>` 或 aria-label**：TokenUsage/MemoryViewer/CronStatus 三张表都是"表头+数据"但无表可读标题。〔P1〕
D8. **LiveIndicator 状态不只靠颜色**：`LiveIndicator.tsx` 红点+文字"live"，颜色已配文字（OK）；但 `TokenBadge` 单色表达程度违背此原则——TokenBadge`>1000 tok 变红` 应加文字阈值或数值。〔P1〕
D9. **滚动条 Firefox 兼容**：`globals.css:135-138` 只有 `-webkit-scrollbar`，加 `scrollbar-width`/`scrollbar-color`。〔P1〕
D10. **--text-faint 对比度核查**：light `#9d9d99` 对 `#e9e9e6` 底在 AA 边界，用于元数据可接受，但别用在正文。审计所有 `color: var(--text-faint)` 用途。〔P1〕
D11. **图表 tooltip 键盘可达**：DotBar hover tooltip（`DotBar.tsx`）是 hover-only，需支持 focus 触发以键盘访问。〔P2〕
D12. **prefers-reduced-motion 兜底**：`rec-pulse`（`globals.css:140-144`）无限脉冲，应加 `@media (prefers-reduced-motion: reduce)` 关闭。〔P0〕
D13. **CronStatus 三态按钮加 aria-pressed**：running/ok/error 状态用颜色+边框表达，应补 `aria-pressed` 或状态文本。〔P1〕

## B. 设计一致性（颜色、半径、字体、图标）—— P0/P1

D14. **AISuggestions 移除硬编码绿/琥珀/红**：`AISuggestions.tsx:6-9` 的 `#059669`/`#d97706`/`#dc2626` 是系统唯一非单色+单红的色，违反 `globals.css:5-6` 文档宣言。用 `--ok`/`--warning`/`--danger` 语义色替代。〔P0〕
D15. **修复 `${color}08` 非法 CSS**：`AISuggestions.tsx:43` 在 `color` 为 `"var(--text-secondary)"` 时拼成 `"var(--text-secondary)08"` → 无效。抽取色值到 token 后用 `color-mix()` 或预定义 subtle 变量。〔P0〕
D16. **统一卡片半径**：`.wd-card`=20px（`globals.css:117`）vs 内联 `rounded-xl`=12px（MemoryViewer 等全 table 面板）vs `rounded-lg`=8px。选一个尺度（建议 16px）全局统一，或明确定义"卡片=16、按钮=pill、输入=8"的规则。〔P0〕
D17. **统一红色 subtle 写法**：`TokenUsage.tsx:153` 用 `var(--danger-subtle)`，但 `CerebrumViewer.tsx:29,34`、`CronStatus.tsx:98` 用裸 `rgba(220,38,38,.2)`。同一语义两种实现。全用 `--danger-subtle`。〔P0〕
D18. **CronStatus 移除 `#e5484d` 兜底**：`CronStatus.tsx:72` 引入系统色板外红号。用 `var(--danger)`。〔P0〕
D19. **统一图标语言**：emoji（📂🐛🏆📋🛡✦，`AnatomyBrowser.tsx:141`、`BugLog.tsx:21`、`AISuggestions.tsx:5-9`）vs 几何字形（◈▸◎⚖▪，`CerebrumViewer.tsx`）混用。学 emoji 用 glyph，或全换统一 SVG 图标（@phosphor-icons/react）。〔P1〕
D20. **StatusBadge 颜色语义列全**：ok=墨点/warn=描边红/bad=实心红是好的；但 `--ok` 用中性墨不是绿（`globals.css:41`）是对单色规则的坚持，保留并注释说明防未来误改。〔P1〕
D21. **`wd-card-inverted` 双主题反差补齐**：dark 是"黑底浅卡"（`globals.css:66`）、light 是"浅底深卡"（`globals.css:41`），方向相反，同一组件两主题观感不一致。让反色卡在两主题都保持"同向对比"。〔P1〕
D22. **抽屉出 --series-* 无值语义**：图表 series-1/2/3 是灰阶，但 series-red 是信号红；补一张注释/文档说明"series 顺序=时间序，红=over-limit"。〔P2〕
D23. **Doto 字重只用 700/900**：Doto 只有 700/900 两档（`index.html:9`），dot-display 用 weight 900（`globals.css:99`）；700 是否用到？未用到就只加载 900 减 CDN 负担。〔P2〕
D24. **Space Grotesk 局部离线条**：`Space Grotesk`（sans）+`Space Mono`（mono）+`Doto`（dot）三字体并存；确认 Grotesk 的 400/500/600 都实际用到，只留用到的字重。〔P2〕

## C. 组件去重抽取（消除×3/×5/×4 样板）—— P1

D25. **抽 `WdTable` 共享表格组件**：TokenUsage:110-145 / MemoryViewer:52-76 / CronStatus:42-81 三处手写 `<table>`（thead `.wd-label` + tbody `border-top/bottom`）。抽一个接受 `columns` + `rows` 的组件。〔P1〕
D26. **抽 `SearchInput`**：5 处完全相同的搜索框（`ActivityTimeline.tsx:45-48` 等）。带 aria-label + 统一样式 + focus ring。〔P0〕
D27. **抽 `CollapseCard`（带 aria）**：MemoryViewer:38-79 / CerebrumViewer / BugLog:62-104 / CronStatus:84-138 四处 accordion。统一 `aria-expanded` + hover 背景 + 展开分隔。〔P0〕
D28. **抽 `WdCard` 接管内联 `rounded-xl`**：把散落的内联卡片（`border:1px solid var(--border)`）改用 `.wd-card`（统一半径+surface 色）。〔P1〕
D29. **抽 `hover 背景` 抽象**：6 处 `onMouseEnter/onMouseLeave` 手写改 `currentTarget.style.background`（`TopNav.tsx:80`、`MemoryViewer.tsx:41` 等）。换成 CSS `:hover` 类（`.wd-row:hover`)或 `<button>/<li> hover:` 的 className。〔P1〕
D30. **抽 `PanelHeader`**：卡片标题 `.wd-label` + 元信息 `.wd-label text-faint` 模式（`TokenUsage.tsx:83`、`ProjectOverview.tsx:99` 等 7 处）。〔P2〕

## D. 状态呈现（空/加载/错误）—— P0/P1

D31. **启用 EmptyState 并统一空态**：`EmptyState.tsx` 写了但 0 处 import。所有 panel 的手写空态（emoji 混杂 + `py-16` 文本）换成 `EmptyState`（带 icon + 标题 + 引导 + 可选动作）。〔P0〕
D32. **loading 从纯文本改骨架**：`App.tsx:44-53` "OPENWOLF / loading…" 纯文本；Skeleton()（`App.tsx:17-29`）只在 panel 懒加载用。数据初次加载也走骨架（对应各 panel 形状）。〔P1〕
D33. **error boundary 组件**：无通用错误边界；一个 panel 抛错会炸整页。加 React ErrorBoundary + 每 panel 降级卡。〔P1〕
D34. **`BugLog` 空态去 emoji**：🐛 → 统一 glyph/图标。〔P1〕
D35. **`AnatomyBrowser` 空态去 emoji**：📂 → glyph。〔P1〕
D36. **`AISuggestions` 空态去 ✦**：→ glyph。〔P1〕
D37. **图表内空态对齐**：`TokenUsage.tsx:86` "No session data yet" 用 EmptyState 小尺寸变体。〔P1〕

## E. 视觉层级 & 排版 —— P1/P2

D38. **StatTile 补 size=4xl 并删无用 lg**：`sizeMap`（`StatTile.tsx:14`）缺 4xl，`lg`(text-5xl) 无调用者。尺寸阶梯对齐（md=3xl, lg=4xl, xl=6xl？或填 4xl）。〔P1〕
D39. **`dot-display` 数值对齐**：tabular-nums 已有（`globals.css:100`）；确认表格内大数值也用 dot-display 而非裸 text —— 让"点阵=关键数值"一致。〔P1〕
D40. **数字大字最小字重检查**：dot-display weight 900 + text-5xl/6xl，检查深色下是否过粗、需 `font-weight` 提亮层级（用色不要用字号堆）。〔P2〕
D41. **hero 节省块层级**：`ProjectOverview.tsx:87-93` 反色卡里 hero 节省数字是 `size=xl`，确认与 Stat 行 `md` 的层级差明显（xl vs md 差距够）。〔P2〕

## F. 数据呈现（dot-matrix 强化、图表）—— P1/P2

D42. **DotBar 加点击选中**：hover tooltip 已有；加 click 选中柱并联动对应数据行（比如点击某天柱显示当天事件列表）。〔P1〕
D43. **DotBar 加图例/轴标签**：横轴目前只有 hover tooltip，无 x 轴标签。加「Mon/Tue/…」或日期标签（`DotBar.tsx`）。〔P1〕
D44. **图表空态态点阵风格**：图表无数据时，用 6px 灰点填满（dot-off 色）示意"空矩阵"而非文字。〔P2〕
D45. **TokenUsage 增加"over-limit"点阵标记**：当 measured > budget，DotBar 对应柱用 series-red 高亮 + 数值用 accent 红。已有 series-red 机制（`globals.css:36`），接入 TokenUsage。〔P1〕
D46. **StatTile 数值加单位语义**：`ProjectOverview.tsx:135-146` 的 stat 行数值+单位，确认单位用 `--text-faint` 且不喧宾夺主。〔P2〕

## G. 性能 & 体验 —— P2

D47. **字体 CDN 加 `display=swap` 检查**：`index.html:7-9` 是否带 `&display=swap`，无则补，避免 FOIT。〔P1〕
D48. **`useLiveUpdates` 节流**：live 更新若过频，加 debounce，避免面板重渲染抖动。〔P2〕
D49. **panel 懒加载粒度**：已是 `React.lazy`（`App.tsx:7-15`），确认 chunk 边界合理（每 panel 一 chunk，不打包成单 chunk）。〔P2〕
D50. **hash 深链保留滚动位置**：`/#tokens` 切换 panel 时保留滚动位置（`App.tsx:34-40`）。〔P2〕

## H. 主题 / 品牌 —— P2

D51. **主题切换加过渡**：dark/light 切换加 `transition: background-color .2s`，避免生硬跳变（`globals.css`）。〔P2〕
D52. **`--accent` 高对比度核查**：dark `#ff4438` 对 `#0a0a0a` 底对比度尚可；light `#d71921` 对 `#e9e9e6` 需 AA 标准（用于 focus ring 时至少 3:1）。〔P1〕
D53. **保存主题偏好到 localStorage 失败兜底**：`useTheme.ts:6-12` 读 localStorage，若被禁需 fallback。〔P2〕
D54. **主题跟随系统选项**：只支持手动 toggle；加"follow system"三态（dark/light/system）。〔P2〕

## I. 布局 & 信息架构 —— P1/P2

D55. **TopNav 深链当前项高亮**：`App.tsx:34-40` switch 路由但 TopNav 无"当前 panel"指示。加 active 状态。〔P1〕
D56. **Layout 加 footer**：`Layout.tsx:5` 无 footer（版本号、doc 链接）。〔P2〕
D57. **panel 分组导航**：11 个 panel 平铺；按「记忆 / 状态 / 工具」分组或用 menu。〔P2〕
D58. **`max-w-7xl` 大屏利用率**：`Layout.tsx:5` max-w-7xl；2xl 屏可自适应更宽（`max-w-[1600px]`）看数据。〔P2〕

## J. 代码卫生 —— P1/P2

D59. **删除 EmptyState 未用 import 修补**：EmptyState 不 import 就要么用起来（D31）要么删。〔P1〕
D60. **StatTile `variant="outline"` 未用**：`StatTile.tsx:7,21` 定义了但 0 调用。要么实现要么删。〔P1〕
D61. **`.pulse-green` 遗留别名清理**：`globals.css:147` "legacy alias"——查还有没有引用，无则删。〔P1〕
D62. **颜色内联转 className token**：散落的 `style={{ background:"var(--bg-surface)" }}` 抽成 `.wd-input`/`.wd-surface` 类。〔P1〕
D63. **将配色注册进 Tailwind `@theme`**：Tailwind 4 CSS-first，把 `--bg-surface` 等注册成 `@theme` token，用 `bg-surface` 类而非内联。当前全内联（`globals.css` 只用 CSS vars 未接 `@theme`）。〔P1〕
D64. **red subtle 变量一致性**：CerebrumViewer 裸 rgba 改 `--danger-subtle` 后，再 grep 清一遍 `rgba(220,38,38` 残留。〔P1〕

## K. dot-matrix 品牌识别强化 —— P1/P2

D65. **dot-display 用于所有关键状态数字**：坏 bug 数、pending 次数、recurrence_rate 等关键指标都用 dot-display（`globals.css:97-103`），现在只有 Budget/Token 用。〔P1〕
D66. **loading 用点阵动画**：`App.tsx:44-53` "loading…" 换成 Doto 点阵跳字或点阵 spinner，强化品牌。〔P1〕
D67. **401/错误页用 dot-display**：`App.tsx:59` 的 "401" 已用 dot-display（好），补一个点阵风格的错误说明。〔P2〕
D68. **点阵空状态**：D44 同，空态用点阵占位。〔P2〕

## L. 具体 panel 品控 —— P1/P2

D69. **AISuggestions 卡片语义色**：Achievements/Next Tasks/Risks 用 `--ok`/`--warning`/`--danger`（D14 落地），并去掉字符串拼色 bug（D15）。〔P0〕
D70. **CronStatus 按钮 radius 统一**：`CronStatus.tsx:68` Run Now 按钮 `rounded-md` vs 表卡 `rounded-xl`。统一。〔P1〕
D71. **MemoryViewer 空态对齐**：`MemoryViewer.tsx:28` 文本空态改 EmptyState。〔P1〕
D72. **ActivityTimeline 空态对齐**：`ActivityTimeline.tsx:56`。〔P1〕
D73. **BugLog 空态对齐**：`BugLog.tsx:18-28`（去 emoji）。〔P1〕
D74. **AnatomyBrowser 空态对齐**：`AnatomyBrowser.tsx:139-143`（去 emoji）。〔P1〕
D75. **CronStatus 空态对齐**：`CronStatus.tsx:92-94`。〔P1〕
D76. **TokenUsage 空态对齐**：`TokenUsage.tsx:87,113`。〔P1〕
D77. **ProjectOverview 空态对齐**：`ProjectOverview.tsx:199`。〔P1〕

## M. 交互细节 —— P1/P2

D78. **表格行 hover 高亮统一**：三张 table 的 row hover 目前不一致，统一 `.wd-table-row:hover` 背景。〔P1〕
D79. **按钮 tactile feedback**：所有按钮加 `:active { transform: translateY(1px) }`（taste 3.E 的物理按压）。〔P1〕
D80. **`LiveIndicator` 加 `role="status"` + aria-live**：`LiveIndicator.tsx:5-8`，实时状态通知屏幕阅读器。〔P0〕
D81. **`EmptyState` 动作按钮**：EmptyState 应支持可选 action（如"刷新"），现在无。〔P1〕
D82. **搜索框加清除按钮**：5 处搜索框加 `type="search"` 原生清除或 X 按钮。〔P2〕
D83. **数字列右对齐**：mono 数值列（TokenUsage/MemoryViewer）右对齐增强可读性。〔P1〕
D84. **长路径截断**：AnatomyBrowser 长文件路径溢出，加 truncate + title tooltip。〔P1〕

## N. 语义化 & 结构 —— P1/P2

D85. **面板标题用 `<h2>` 语义**：现在多用 `.wd-label` span；panel 主标题该是 `<h1>/<h2>`。〔P1〕
D86. **`<table>` 用语义 `<th scope>`**：表头 `<th>` 加 `scope="col"`。〔P1〕
D87. **筛选/排序按钮 `aria-pressed`**：`ActivityTimeline.tsx:34-53` segmented 控制。〔P1〕
D88. **导航用 `<nav>` + aria-current**：TopNav。〔P1〕

## O. 对比度 & 色彩可及性 —— P0

D89. **`--warning` 对比度核查**：light `#8a6d00` 对 `#e9e9e6`，用于文本需 AA。审计所有 `var(--warning)` 用途。〔P1〕
D90. **红点状态色对比**：`StatusBadge`/`LiveIndicator` 的红点在浅底上对比度是否够，保证 3:1（非文本 UI 对比度）。〔P1〕

## P. 未来扩展（探索性）—— P2

D91. **点阵热力图**：用 dot-matrix 点阵做"活动热力图"（如 GitHub 贡献图风格），强化品牌。〔P2〕
D92. **主题色可定制**：暴露 `--accent` 可配置（不同项目换 accent），但仍单色单 accent 原则。〔P2〕
D93. **面板拖拽排序**：`ProjectOverview` 的 bento 块可拖拽自定义布局（本地持久化）。〔P2〕
D94. **图表导出**：TokenUsage/DotBar 导出 PNG/CSV。〔P2〕
D95. **可折叠侧边栏**：`Layout` 加窄侧边栏（可折叠）而非纯顶部导航，放 panel 分组。〔P2〕
D96. **实时流式面板**：live 数据用流式更新而非轮询（`useLiveUpdates` 目前轮询）。〔P2〕
D97. **记忆时间轴可视化**：MemoryViewer 加点阵时间轴（事件在轴上点阵分布）。〔P2〕
D98. **对比度调试模式**：隐藏的 a11y 开关，一键高亮所有低对比度元素（开发用）。〔P2〕
D99. **空态插画**：EmptyState 支持轻量单色 SVG 插画（点阵/几何），不破坏单色。〔P2〕
D100. **键盘快捷键**：`/` 聚焦搜索、`t` 切主题、`1-9` 切 panel（单色 dashboard 工具感）。〔P2〕

---

## 分布总览

| 类别 | P0 | P1 | P2 |
|---|---|---|---|
| A 可访问性 | D1-6,12 | D7-10,13 | D11 |
| B 一致性 | D14-18 | D19-21 | D22-24 |
| C 去重抽取 | D26,27 | D25,28,29 | D30 |
| D 状态呈现 | D31 | D32-37 | — |
| E 视觉层级 | — | D38 | D39-41 |
| F 数据呈现 | — | D42,43,45 | D44,46 |
| G 性能体验 | — | D47 | D48-50 |
| H 主题 | — | D52 | D51,53,54 |
| I 布局 | — | D55 | D56-58 |
| J 代码卫生 | — | D59-64 | — |
| K 品牌强化 | — | D65,66 | D67,68 |
| L 具体 panel | D69 | D70-77 | — |
| M 交互 | D80 | D78,79,81,83,84 | D82 |
| N 语义化 | — | D85-88 | — |
| O 对比度 | — | D89,90 | — |
| P 扩展 | — | — | D91-100 |

**P0 共 11 条**：D1,D2,D3,D4,D5,D6,D12,D14,D15,D16,D17,D18,D26,D27,D31,D69,D80 —— 让我重数。

实际 P0（标注〔P0〕的）：D1,D2,D3,D4,D5,D6,D12,D14,D15,D16,D17,D18,D26,D27,D31,D69,D80 = **17 条**。
P1：其余重点。P2：探索。

## 建议执行顺序（P0 从最高杠杆起）

1. **a11y 批量**（D1-D6, D12, D80）：focus ring + aria-label + aria-expanded + reduced-motion —— 一次框架改动，惠及全 dashboard。
2. **颜色红线**（D14, D15, D17, D18, D69）：AISuggestions 破单色 + 裸 rgba + `#e5484d` —— 修色板破坏。
3. **组件去重**（D26, D27）：SearchInput + CollapseCard —— 消除 5×/4× 样板并顺手带 aria + focus。
4. **半径统一**（D16）+ **空态启用**（D31）—— 一致性 + 状态呈现。
