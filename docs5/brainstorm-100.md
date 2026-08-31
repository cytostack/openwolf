# OpenWolf 改进建议 100 条（brainstorm，按维度内优先级排序）

> 生成：2026-08-30。依据：对 openwolf 代码库的深度阅读（STATUS.md / cerebrum.md / anatomy.md / src/** / benchmarks/**）+ 外部参考 `D:\GitRepo-AI\ai-scrape-research\github-research\AGENTS_REPO.md`（2026-08-30 GitHub live 快照，覆盖 spec-driven / TDD / autonomous / multi-agent / self-learning / skills 六大类）。
> 每条 = 一个可落地动作方向，不展开实现。**每个维度内部按优先级排序：`〔P0〕`（正确性/数据安全/核心价值证明）→ `〔P1〕`（明确的健壮性/效率/可维护性提升）→ `〔P2〕`（增强/扩展/探索/产品方向）。**
> 编号 1-100 是稳定索引（与首版一致），不随优先级重排。
> 标 `[外部]` 的是从 AGENTS_REPO.md 里对标到的成熟做法。

---

## A. 记忆系统（hippocampus / claims / trajectory / cerebrum / anatomy）— 15 条

### P0（正确性 / 数据安全）
1. **事件 schema 版本化迁移**：`WolfEvent` 已两次删字段（`is_recurring`、`first_event_id`），旧 store 里历史事件还带着这些字段，现在靠 `normalizeStoreStats` 兜底。加 `schema_version` + 显式迁移函数，删字段时留迁移记录。〔P0〕
5. **修 `turn_in_session` 硬编码 0**：`post-write.ts` / `user-prompt.ts` / `post-test.ts` 全写 `turn_in_session: 0`，trajectory 排序只能靠 timestamp，同毫秒会错序。由 session-start/stop 钩子真实计数，这是轨迹匹配正确性的前提。〔P0〕
15. **evidence 优先级回归测试**：evidence 强度排序（测试 > 运行结果 > 用户纠正 > 检查 > 推理 > 假设）是 claims 的核心，但没测试锁定。写一个"证据强度必须支配召回排序"的回归测试，防止将来改坏。〔P0〕

### P1（健壮性 / 可维护性）
2. **召回排序加多样性去重**：`recallEvents` 可能返回高度相似的事件（同 path 多条创伤）。加 MMR 或 signature 去重，别让 top N 全是一个模式的重复。〔P1〕
7. **衰减逻辑注入时钟**：`consolidation.ts` 的 `calculateDecay` 读真实墙钟，测试难写。像 `countSemanticEntries` 那样注入可选 `now` 参数。〔P1〕
8. **question/state 索引要么用起来要么删**：`cue-index.ts` 维护三个索引，但 `recall` 实际只靠 location，question/state 是死索引。要么让 pre-read 问题型 cue 真走 question 索引，要么删掉。〔P1〕
9. **claim scope 的路径段匹配**：claim 召回按 scope 字符串归一化，没做父子目录关系。`src/hooks/shared.ts` 的 claim 应也能命中 `src/hooks` 范围（像 cue-recall 的 `match_mode:"parent"`）。〔P1〕
10. **trauma 永不 evict 的总上限**：`addEventToStore` buffer 满时跳过 trauma，极端下 buffer 全被 trauma 占满、正常事件被挤掉。给 trauma 设占 buffer 比例上限。〔P1〕
11. **遗忘可观测**：consolidation 会 forget 低分事件，但没有"过去 X 天忘了 Y 条"的报告。用户不知道记忆在丢什么，无法判断衰减阈值对不对。〔P1〕

### P2（增强 / 探索）
3. **claim candidate 队列健康度可观测**：approve/reject 靠人工 CLI，但队列堆了多少条、最老多久没审，dashboard/report 不显示。加 `openwolf claim candidate stats`。〔P2〕
4. **trajectory 参数可配置**：`k=3`、`samples>=3`、`bad_ratio>=0.5` 硬编码。进 `settings.json` 调灵敏度。〔P2〕
6. **neocortex 语义检索**：`getNeocortexEvents` 只按 valence/intensity/时间过滤，没有语义检索，长尾记忆捞不出来。〔P2〕
12. **消费 `recent_errors` 原料**：trajectory 设计稿点名 `context.recent_errors` 有原料但没用。让签名把最近错误类型纳入。〔P2〕
13. **跨 session 轨迹**：v1 只做 session 内（设计稿明确排除）。下一步做跨 session 全局轨迹。〔P2〕
14. **跨项目经验汇总层**：记忆 per-project 隔离，但 godot 的 cerebrum 曾暴露 openwolf 源头的 bug。加一个跨项目"经验回传"层。〔P2〕

## B. 上下文管理 & token 效率 — 10 条

### P0
16. **anatomy token 估算实测校准**：`estimateTokens` 是启发式，用真实 tokenizer 校准，否则"省 1M token"这个 outcome 数字没可信度。〔P0〕
19. **消除 STATUS.md 与 specs-state.json 双源漂移**：已加 `status-check.ts` 的 warn，但只是告警。改成单一事实源——STATUS.md 由 specs-state.json 派生或反向，别让两份手写文档漂。〔P0〕

### P1
18. **pre-read claim 注入按 relevance 排序**：现在取"最多 3 条 active claim"，但没按与当前文件的 cue 匹配度排序。用 cue 匹配打分取 top3。〔P1〕
20. **memory.md 去重压缩**：堆了大量重复 "Session end: ..." 行。按 session 聚合，只留"本 session 结论 + 关键动作"。〔P1〕
22. **拆大文件**：`shared.ts`（7800 tok）、`description-extractor.ts`（12792 tok）读进上下文很贵，后者语言分支按需懒加载。〔P1〕

### P2
17. **anatomy 层级按需折叠**：`src/dashboard/app/components/panels/` 太深，全量展开很长。读取时只展开相关子树。〔P2〕
21. **上下文预算实时仪表**：dashboard 缺"当前会话 token 用量、anatomy 命中数、省了多少"的实时视图。〔P2〕
23. **JOURNEY / memory / cerebrum 分工**：三者都记历史，职责重叠。明确 JOURNEY=人机协作叙事、memory=动作日志、cerebrum=持久教训。〔P2〕
24. **skill 按需加载**：26+ skills 全量列 system prompt，按任务类型路由。〔P2〕
25. **摘要缓存 + 过期策略**：cerebrum/anatomy 摘要加生成时间戳和失效条件，源文件改动后自动重生成。〔P2〕

## C. 多 agent 编排 & 自治（night-run）— 12 条

### P0（夜跑安全）
29. **[外部] human-in-the-loop 护栏**：对标 `humanlayer/12-factor-agents`。夜跑前定义"哪些操作需人确认"，不是无脑全自动。〔P0〕
30. **夜跑预算封顶**：token/时间/轮数三上限，防自治跑失控烧钱。Kilo goal 已有 round cap，OpenWolf 要对应物（cron 任务预算）。〔P0〕
31. **[外部] verifier 角色兜底**：对标 cron-pipeline 的 Agent #4（test verifier 永远在 reviewer 后跑）。夜跑任何实现都必须过独立验证，不能自己验收自己。〔P0〕

### P1
26. **[外部] 隔离的自治实现运行**：对标 `openai/symphony` 的 "isolated autonomous implementation runs"——把 spec 拆成隔离实现 run，人只管验收。〔P1〕
27. **[外部] orchestrator + 子 agent**：对标 `agent-teams-lite`（1 orchestrator + 9 子 agent）。spec 分解后并行派子 agent，各自 worktree 隔离。〔P1〕
28. **[外部] worktree 隔离 + auto-merge**：对标 `spec-kitty`。多子 agent 并行改同一 repo，各自 worktree，merge 前跑 CI 门。〔P1〕
32. **SDD 状态机的失败回退**：`src/specs` phase forward-only，implement 失败回 tasks 已有，但缺"测试红自动回 plan"的强制。〔P1〕
33. **统一事件总线跨 harness**：三个 harness 事件/记忆各写各的，缺统一 event bus 实时同步同一 `.wolf/`。〔P1〕
36. **失败自动回 plan 的机制化**：把"测试红 → 强制回 plan 阶段"写进 spec 状态机转移条件，不靠 agent 自觉。〔P1〕
37. **长任务 checkpoint 恢复**：夜跑中断后从 checkpoint 恢复（哪些 spec 完成、task 到哪）。〔P1〕

### P2
34. **cron 任务优先级/依赖/重试退避**：`cron-state.json` 是简单队列，缺依赖、优先级、指数退避。〔P2〕
35. **[外部] 结构化 handoff**：对标 `openai/swarm` 的 handoff。spec 阶段产物（specify→plan→tasks）schema 化，别只靠 Markdown 约定。〔P2〕

## D. 测试 & benchmark & 质量门 — 12 条

### P0
39. **CI 跑行覆盖率 + 设门槛**：benchmark 支持 `--coverage` 但默认不跑。CI 跑并设下限，防回归。〔P0〕
41. **outcome 维度合成数据测试**：benchmark outcome 现在 0/0，`recurrence_rate` 公式本身没测过。注入合成 store 验证 rate/backfill/0 分母边界。〔P0〕

### P1
38. **清 138 个 coverage gap**：coverage 31.7%，138 个 untested seam 多是 CLI 入口和死代码。命令入口加 smoke，死代码删。〔P1〕
40. **mutation testing 自动化红检**：把"green 后故意改坏要变红"的自觉做成 mutation testing（改运算符/反转条件）。〔P1〕
42. **性能回归门槛**：`baseline.json` 有基线但没自动"慢于基线 X% 报警"。加 perf 回归检测。〔P1〕
43. **flaky 检测器**：cerebrum 记过时间依赖的坑。加"重跑 N 次统计通过率"的 flaky 标记。〔P1〕
44. **测试 build 前置显式化**：多个测试 spawnSync 跑 `dist/hooks/...`，隐式依赖 build。要么 test script 强制 build 前置，要么测源码。〔P1〕
45. **端到端全链测试**：缺"init → 写入 → recall → consolidate → 跨 session 恢复"完整链路。〔P1〕
47. **seams.json 从源码自动生成**：手动维护必漂移（刚删的 `is_recurring` 就没在 seams 里）。用 TS AST 提取导出函数名自动生成。〔P1〕
48. **期望值独立来源的 lint**：cerebrum 强调"期望值不跟实现同算法重算"，做成 lint 检测该反模式。〔P1〕
49. **CLI 命令 smoke 测试**：report/survey/dashboard/daemon/cron/designqc/reframe 完全没测。每个命令加"空项目跑一遍不崩"。〔P1〕

### P2
46. **benchmark 迭代次数自适应**：固定 100k 次，应该跑到置信区间稳定或设时间预算。〔P2〕

## E. 可靠性 & 存储 — 10 条

### P0
50. **去重 `copyHookScripts`**：`init.ts` 和 `update.ts` 各一份且已漂移（update.ts 缺 `user-prompt.js` + `post-test.js`，见 cerebrum）。抽一份共享实现。〔P0〕
53. **Windows 崩溃一致性验证**：原子写靠 sibling-temp + fsync + rename，Windows 上 fsync 语义不同，应显式验证崩溃一致性。〔P0〕
58. **事件 ID 跨进程唯一性**：`addEventToStore` 的 ID 生成没验证跨进程唯一，并发 8 进程若 ID 撞了会静默丢事件。〔P0〕

### P1
51. **锁 owner 心跳 + 自动清理**：stale 锁需人工确认。加 owner 心跳，区分"进程死了"（可自动清理）和"进程慢"（不清理）。〔P1〕
52. **增量 vs 全量校验分离**：完整索引校验影响热路径。写入时增量、冷启动时全量，别每次写都全量扫。〔P1〕
54. **fail-open 也要留痕**：hooks 全 fail-open（静默吞错），坏了没人知道。fail-open 时写 stderr 告警或进 buglog。〔P1〕
55. **跨进程 + 跨目录竞争测试**：并发测试覆盖 8 进程同目录，缺跨目录锁竞争和不同项目根隔离测试。〔P1〕
56. **size_bytes 与 evict 判定一致**：`size_bytes` 是 JSON.stringify 长度，buffer 满的 evict 按条数判定，两个"满"口径不一致。〔P1〕
57. **备份文件损坏路径**：recovery 测试覆盖主 store 损坏，没测"备份文件也损坏"时会不会二次崩溃。〔P1〕
59. **版本化 store 数据迁移**：旧 store 结构升级没有显式迁移脚本，靠 load 时 normalize。加 version + 迁移函数（与 #1 呼应：那个管 schema 这个管数据）。〔P1〕

## F. 安全 & 隐私 — 8 条

### P0
60. **敏感路径白名单化**：`isSensitiveFile` 是黑名单，漏一个就出事。改成"白名单放行 + 黑名单兜底"，默认拒绝记入记忆。〔P0〕
61. **主动 credential 检测**：事件内容里的 token/密钥没有主动检测。写事件前扫描高熵串并脱敏。〔P0〕

### P1
62. **记忆删除权**：用户应能"忘记"某条记忆。现在只有 backup 没有删除 API。加 `openwolf forget <id>` 和 claim 显式删除。〔P1〕
63. **dashboard auth 强度验证**：`dashboard-auth.ts` 的 token 强度、默认开启、daemon 端口暴露面没验证。〔P1〕
64. **绝对路径脱敏**：事件 context 存绝对路径、跨盘符、用户主目录，多机共享 store 泄露机器布局。存相对路径 + 机器指纹分离。〔P1〕
66. **夜跑权限最小化**：自治运行时不应"无限制写任何文件"。给 cron/夜跑受限文件范围，越界即停。〔P1〕
67. **审计进 CI**：`pnpm audit` 已过，但应进 CI 每 commit 跑，不靠手动。〔P1〕

### P2
65. **sensitive scope 拒绝留痕**：claims 的 sensitive scope 拒绝是静默的。拒绝时给一条可解释日志。〔P2〕

## G. CLI & DX & dashboard — 10 条

### P1
68. **统一 JSON 输出 schema**：`--json` 在 spec/recall/claim 有、report/survey/status 不一致。统一 `{ok, data, error}`。〔P1〕
69. **统一退出码与错误语义**：`fail()` 的退出码、stderr 格式不统一。定约定：exit 1 + 机器可读错误码 + 人读信息。〔P1〕
70. **dashboard 支持 claim 操作**：MemoryViewer/ClaimViewer 只读。加 approve/reject（"dashboard claim 管理"的 CLI 验证前提已满足）。〔P1〕
73. **update 的 breaking change 检查**：`openwolf update` 检查 schema 版本不兼容并提示备份，不盲更。〔P1〕
75. **多项目健康概览**：registry 有 registerProject，但缺"一眼看所有注册项目健康"的概览命令。〔P1〕

### P2
71. **shell completion**：`openwolf` 没有 zsh/bash 补全。〔P2〕
72. **非交互式 init**：`initCommand` 支持 `--yes`/flag 驱动，方便脚本化和夜跑初始化。〔P2〕
74. **日志分级**：没有 `--verbose`/`--quiet`，调试靠猜。〔P2〕
76. **daemon 日志过滤**：`daemonLogs` 支持按时间/级别/关键字过滤。〔P2〕
77. **designqc/reframe 跨 harness**：这俩是 Claude 专属命令，要么通用化要么文档说明适用边界。〔P2〕

## H. 跨 harness 集成（Claude / OpenCode / Kilo）— 8 条

### P0
79. **统一事件 envelope 抽象**：sessionIdOf 的差异（Claude `event.session_id` / Kilo `properties.info.id` / OpenCode top-level）已踩坑。抽 `canonicalSessionId(event)` 统一入口，各 harness 只写适配。〔P0〕

### P1
78. **消除 Kilo plugin 拷贝漂移**：Kilo plugin 是 OpenCode handler 的 thin 拷贝，两份会漂。要么生成要么抽共享层。〔P1〕
80. **决定 OpenWolf 侧 goal 行**：Kilo 的 goal 是原生 kilocode 实现，OpenWolf 没有。明确决策：OpenWolf 要不要自己的 goal 行，还是长期复用 STATUS.md。〔P1〕
81. **统一事件 ID 语义**：三个 harness 的 session id 语义不同，影响 trajectory 的"按 session 分组"。统一成 canonical key 并写文档。〔P1〕
82. **插件加载失败可见性**：Kilo plugin 加载失败应有 TUI 提示（Phase 1 §B 待办），不静默不工作。〔P1〕
83. **跨 harness 记忆共享验证**：同一项目在 Claude 和 Kilo 下应共享 `.wolf/` 记忆，验证并测试（防一个 harness 的写入破坏另一个的读取）。〔P1〕

### P2
84. **运行时 hook 特性检测**：不同 harness 支持的 hook 类型不同，运行时探测而非假设全支持。〔P2〕
85. **插件与 core 版本解耦**：OpenCode/Kilo 插件版本与 core 耦合，升级要同步。加版本兼容检查或解耦。〔P2〕

## I. outcome 测量 & 自学习闭环 — 10 条

### P0
86. **真正跑 outcome 测量**：现在 0/0（dogfood dormant），STATUS.md 下一阶段就是它。这是"记忆到底有没有用"的唯一证据，优先级最高。〔P0〕
92. **`openwolf doctor` 记忆体检命令**：自动检测死字段、未消费数据、双源漂移、索引损坏——我手动发现的 `is_recurring`/`first_event_id` 让机器自动找，防同类问题复发。〔P0〕

### P1
87. **细粒度复发归因**：`recurrence_rate = recurrences / negative_writes` 太粗，"同 bug 复发"和"不同 bug"混一起。归因关联到具体 error signature。〔P1〕
88. **A/B 对照设计**：STATUS.md 提过"decide whether A/B control arm is warranted"。设计对照组（同任务、有记忆 vs 无记忆）。〔P1〕
89. **反馈闭环可测**：用户纠正 → penalty → recall 注入 → 是否避免复发，每环加计数和转化率。〔P1〕
90. **token 节省对照验证**：token-ledger 记 "estimated savings ~1.05M"，但没对照实验证明"anatomy 命中真省了 token"。〔P1〕
91. **学习回收率指标**：cerebrum 自动记教训，但没"哪些教训被后续 session 真引用过"的回收率。〔P1〕

### P2
93. **警告转化率**：trajectory 预警、pre-read 创伤注入，用户是否因此少犯错没度量。加"被触发 → 后续是否还有同类 penalty"追踪。〔P2〕
94. **[外部] 标准记忆任务评估**：对标 `claude-mem`/`mem0`，用标准记忆任务集（记住偏好/跨 session 召回/纠正后更新）评估召回质量。〔P2〕
95. **claim 采纳后回测**：claim candidate approve 是"提案→人工采纳"，缺"采纳后效果回测"——注入后是否真让结果变好。〔P2〕

## J. 文档 & 工程卫生 — 5 条

### P1
97. **死代码审计**：`description-extractor.ts`（12792 tok）大量语言分支可能没测没用，`shared.ts`（7800 tok）同理。做一次死代码审计，删没用的。〔P1〕

### P2
96. **docs 目录索引**：docs2/docs3/docs4/docs5 编号混乱，加 docs/README 或 index 说明各自用途。〔P2〕
98. **AGENTS.md / CLAUDE.md 单一来源**：两者有重复规则。抽 canonical 规则文件，其余引用。〔P2〕
99. **收紧 `Record<string, any>`**：`performance.ts` 的 `mods: Record<string, any>` 等宽松类型收紧成具体接口。〔P2〕
100. **依赖精简评估**：core 坚持 node-builtin-only，但 dashboard 引入 Vite/React 全家桶。评估 dashboard 是否拆独立包。〔P2〕

---

## 附：优先级分布总览

| 维度 | P0 | P1 | P2 | 小计 |
|---|---:|---:|---:|---:|
| A 记忆系统 | 3 | 6 | 6 | 15 |
| B 上下文 & token | 2 | 3 | 5 | 10 |
| C 多 agent & 自治 | 3 | 7 | 2 | 12 |
| D 测试 & benchmark | 2 | 9 | 1 | 12 |
| E 可靠性 & 存储 | 3 | 7 | 0 | 10 |
| F 安全 & 隐私 | 2 | 5 | 1 | 8 |
| G CLI & DX | 0 | 5 | 5 | 10 |
| H 跨 harness | 1 | 5 | 2 | 8 |
| I outcome & 自学习 | 2 | 5 | 3 | 10 |
| J 文档 & 卫生 | 0 | 1 | 4 | 5 |
| **合计** | **18** | **53** | **29** | **100** |

**P0 全清单（18 条，跨维度最该先做）**：1、5、15、16、19、29、30、31、39、41、50、53、58、60、61、79、86、92。

> 说明：P0 = 不修会错 / 会丢数据 / 核心价值无法证明；P1 = 有确定的现状问题、修了明确变好；P2 = 增强、扩展、探索、产品方向。这份清单是 brainstorm 不是 roadmap，采纳哪些由你拍板。
