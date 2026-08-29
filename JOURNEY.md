# 协作记录（JOURNEY）— openwolf

> 两列进度日志，自顶向下按时间序（旧→新）。「我」= 人（动作/提问），「你」= AI（响应）。
> 尾部「未决事项」为待办。
> 来源范围：`kilo_local_recall` 只覆盖 2026-08-25 起的 9 个会话（kilo 迁移 / 目标 / 面经）。08-11 的海马体开发与 08-25~26 的影响测量开发，会话转录不在本地 recall 中——下面这两段据 `STATUS.md` + `git log` + `docs2/` 重建，是事实时间线，不是逐条对话。

---

## 当前风险与待办（高亮）

> 扫一眼就知道还欠什么、哪会裂。详细版在文末「未决事项」；正文各段落的描述未删。

- **全量重写 109 个测试（P4）尚未开始**——benchmark harness（P1-P3）已上线：覆盖 51/186（27.4%）、135 缺口；但「按 TDD 质量标准重写全部测试 + 覆盖映射闸门」是大头，还没动（§13）。
- **覆盖数 27.4% 是下界**——按函数名 grep 测试源码，低估「经 `Hippocampus` 类间接覆盖」的函数，只当趋势基线用（§13）。
- **dashboard 函数级 UI 覆盖延后**——`node --test` 跑不了 React，需 vitest+jsdom；v1 只做 build 通过 + 文件存在性（§13）。
- **import 归一化延后**——测试混用 `src/*.ts`（type-strip）与 `dist/**/*.js`（编译），自动覆盖率因此失真；统一到 src 是侵入性改动，未做（§13）。
- **token 节省 1,151,042 是估算不是实测**——`anatomy命中×200`（常数拍脑袋）+ 重复读文件 token（字符÷3.5/4/3.75 估）；真数据在 `real_input_tokens`（≈6.07 亿）那组字段（§13）。
- **Kilo dogfood 已跑，session.created 缺口已修（未提交）**——插件加载、`_session.json` 信封、空闲后 `token-ledger.json` 行均验证；恢复会话不发 `session.created` 的缺口已加 `session.updated` 兜底，剩「重启后确认 `total_sessions` 0→1」未回传。
- **巩固从未运行**——`neocortex.json` total_consolidated=0，PM2 未装、daemon 不跑，短时→长时转移全程空转。
- **claim 层零使用**——`claims.json` / `claim-candidates.json` 均 0 条，只被测试覆盖，未被 dogfood 验证。
- **51 个假 trauma 已重置**（2026-08-27）——编辑次数启发式留下的脏数据，已整体重置为干净基线（备份在 `backup-pre-reset/`），复发率分母清空、待真实负信号重新积累。
- **目标持久化滞留 kilocode**——re-arm、`BudgetLimited`、同条件 blocked 连续三次未做，openwolf 侧目标行未集成。
- **第二阶段延后**——hippocampus / `chat.message` / `bash` post-test、可见 warn 通道、`session.status` 空闲备份。
- **第三阶段延后**——`src/runtime/` 共享运行时抽取。
- **`cli/index.ts` survey 与 kilo 帮助混改**——评审记为卫生问题，未拆分提交。
- **session.created 兜底 + kilocode 安装产物未入库**——模板修复在 `src/templates/kilo-plugin/index.ts` 未提交；kilocode 仓库的 `.wolf/`、`.kilo/plugin/`、`.claude/`、`CLAUDE.md` 未入库，是否入库由 kilocode 仓库决定。

---

## 海马体记忆（hippocampus）开发（2026-08-11，据 STATUS.md + git log + docs2 重建，会话转录不在本地 recall）

| 我（阶段） | 你（交付） |
|----|-----|
| 上游合并 + 吃狗粮（`1f25813`） | 合并 `cytostack/openwolf:main`，保留本地海马体实现与 v2 行为；装全局包并初始化本仓库做 dogfood |
| 海马体加固（`07e78cc`） | Windows 项目边界/路径安全、原子持久化 + 非空目录锁（有界等待、不删废弃锁）、事件库权威 + 线索索引派生可漂移检测可修复、长时转移幂等日志、OpenCode 模板镜像、docs2 文档 |
| 真值维护的 claim 层（`07e78cc`） | 不可变事件/可修订 claim、确定性 NFKC 身份、证据质量+出处评分、争议/取代阈值、`claim record/recall` 命令、`claims.json` + 派生 `claim-index.json`、11 条回归测试 |
| 评审整改（`37495fe`） | 依赖漏洞修复、`.gitignore` 凭据排除、`pnpm-workspace.yaml` 构建策略；`pnpm test` 64/64、`pnpm audit` 干净 |
| 可信学习回路的 CLI 切片 | `claim-candidates.json` 队列（增/列/批/拒）、pre-read/pre-write 注入最多 3 条 active claim（disputed/superseded 不注入、hook 失败放行）；`pnpm test` 68 条 67 过（1 条时间相关的既有失败） |

## 影响测量（2026-08-25~26，据 docs2/hippocampus-impact-measurement.md + 工作区未提交文件重建，会话转录不在 recall）

| 我（阶段） | 你（交付） |
|----|-----|
| 结果归因 + 对照组 | 过程指标→结果指标：`recurrence_rate = recurrences / negative_writes`；退役编辑次数启发式（dogfood 实测 51 假 trauma / 0 真信号）；两个确定性探测器 `src/hooks/user-prompt.ts`（detectCorrection）、`src/hooks/post-test.ts`（extractTestFailures）；`src/cli/survey.ts` 跨仓库聚合；均未提交（untracked） |

## 第 1 节 · kilo 迁移设计（2026-08-25 14:56）

| 我 | 你 |
|----|-----|
| 说明三个仓库关系（openwolf 主要服务 claude code；kilo 是另一个 CLI 应用；openwolf 已为 claude code 实现了一套 harness 钩子），问怎么把这套逻辑迁移到 kilo 的 harness 框架 | 读完 `.wolf/*`、`src/agents/*`、kilo 的 plugin 包后定位接缝：**kilo 的 plugin API 是 OpenCode v1 钩子对象的换皮**，不是 Claude 的 stdin/stdout 子进程。结论 = 把 OpenCode 适配器克隆成 kilo 适配器，改安装路径 + 类型包 + `stop`→`session.idle` |
| 要计划 / 行动项 | 产出 `docs3/kilo-harness-migration.md`（设计：是什么/不是什么、Claude→Kilo 钩子映射、加载约束）+ `docs3/PLAN.md`（第一阶段八步 + 验证清单 + 第二/三阶段延后） |

## 第 2 节 · 自批迁移文档（2026-08-25 16:07）

| 我 | 你 |
|----|-----|
| 自批 `docs3/kilo-harness-migration.md`，改进并生成行动清单 | 发现承重漏点：**事件信封**——OpenCode 事件 id 在顶层，Kilo 嵌套在 `properties.info.id` / `properties.sessionID`，天真克隆会静默空转。重写设计围绕 `sessionIdOf`，写 `docs3/critic/kilo-harness-migration.md`，对齐 PLAN，并在验证清单里显式加信封检查 |

## 第 3 节 · 实现第一阶段（2026-08-25 17:25）

| 我 | 你 |
|----|-----|
| 列三件事：(1) docs3 (2) 实现 openwolf 插件的 kilo 版 (3) 其余 | 实现第一阶段：`src/templates/kilo-plugin/`（拷贝 9 个 handler，`index.ts` 从零写含 `sessionIdOf`）、`src/agents/kilo.ts` 适配器（`export default { id, server }`）、注册 registry + `detectInstalledAgents`、skills 落到 `.kilo/command/`、`tests/kilo-adapter.test.ts` + 解剖锁断言、docs/CHANGELOG。`pnpm test` 95/95，CLI 冒烟 `init --agent kilo` 落盘 + `--agent claude` 不写 `.kilo/` |
| 评审实现 | 跑规范（Spec）+ 标准（Standards）两个 @explore 子代理并行评审 |
| 修 bug 收尾 | 按评审清单收尾：`sessionIdOf` 顶层 fallback 依 PLAN 保留（cerebrum 那条被误读为硬性），`survey` 与 kilo `--agent` 帮助混在同一 `cli/index.ts` 记为卫生问题 |
| 反馈 kilo 报「openwolf — not in this checkout (no code/branch/commit)」 | 判定为 Agent Manager / 工作树跟踪层面的提示，不是插件缺陷，未改插件 |

## 第 4 节 · 自批 PLAN（2026-08-25 17:11）

| 我 | 你 |
|----|-----|
| 自批 `docs3/PLAN.md` 并改进 | 指出 PLAN 流程上不安全：先拷后写会连 OpenCode `index.ts` 一起拷（顶层 sessionID 是致命点），测试只 grep 字符串不执行 `sessionIdOf`。重写 PLAN：只拷 handler、`index.ts` 从零写、拆分 `install()`（不拷 skills）与 `installSkills(["kilo"])`、验证拆成 A（自动合并门）与 B（真实 dogfood） |

## 第 5 节 · Kilo 原生目标持久化（2026-08-25 19:46，kilocode 仓库）

| 我 | 你 |
|----|-----|
| 要求在 kilocode 下自批 + 改进 + 单测目标持久化，直到 openwolf 按计划集成 | 批 kilo 原生目标 harness：**致命点 = `driving` 集合跨越 `prompt()`**，目标回合的 `TurnClose` 在 `prompt()` 等待期间触发，下一个空闲被丢，循环跑一轮就卡死；另两洞 = 完成后再次 create 撞主键、`TurnClose.reason` 被忽略。在 kilocode 修复（pending 槽持锁、删后插、SQL CAS、`synthetic` 标签），`bun run script/test-runner.ts goal.test` 27/27 通过 |

## 第 6 节 · 批 kilo 计划到全绿（2026-08-25 21:17）

| 我 | 你 |
|----|-----|
| 修订 docs3 kilo 计划，批评 + 改进 | 逐条核验 PLAN 的「完成」声明，发现合并门「全绿」在盘上是假的：`handlePrecompact` 在 `_session.json` 缺失时注入了 `session_id`，测试期望 `{}`。最小修复 `session.ts`（快照忠实于磁盘），`pnpm test` 103/103 全绿（PLAN 原来写 95/95 是过期数）。修订 PLAN 状态、`handlePrecompact` 规范、测试导入策略、关闭过期的未决项 |

## 第 7 节 · docs2 面经（2026-08-26 22:11）

| 我 | 你 |
|----|-----|
| 面试要考对 docs2 的修改，出一份面经 | 读 docs2 全部文档 + `src/hippocampus/*`、`src/hooks/*`、`src/cli/survey.ts`，产出面经：一句话结论（事件 vs claim 拆分的真值维护 + 影响测量）、14 道高频题 + 参考答法、必背代码锚点表、6 条取舍、5 个踩坑。核心锚点 `claims.ts:16-28`（证据权重/阈值）、`shared.ts:35`（跨盘路径安全）、`impact-measurement.md`（过程指标→结果指标） |

## 第 8 节 · 技术设计稿转知乎专栏（2026-08-26 23:25）

| 我 | 你 |
|----|-----|
| 用「技术设计稿→知乎」skill，把 docs2 和本仓库的 hippocampus 实现写成知乎专栏 | 读 docs2 全部 + `src/hippocampus/*`、`src/hooks/*` 源码，抽主线「写得多、写得新，不等于真」，产出 `docs2/hippocampus-zhihu/`：`article.md`（约 4000 字，TL;DR + 为什么 + 错路/脉络/树 + 收获结论 + PS/PPS/PPPS）+ `images/` 10 张 PNG（SVG→Playwright 截图栅格化）+ `PUBLISH.md`。数字全部来自源码（证据权重 7 级、取代双条件 0.65/0.2、每周衰减 5%、锁预算 5s/10s、51 假 trauma） |

## 第 9 节 · 复盘 dogfood（2026-08-27 11:07）

| 我 | 你 |
|----|-----|
| 要求复盘 dogfood 的 hippocampus 数据，把教训写进 JOURNEY | 读 `.wolf/` 实际数据 + `docs2/hippocampus-dogfood-verification.md` + `buglog.json`，复盘出 5 条教训（下述实据全部来自磁盘，非文档声称） |

**狗粮实测数据（读 `.wolf/*.json` 得到）：**

- `hippocampus.json`：total_events=313，**trauma_count=51、penalty_count=0、reward_count=0**。51 个 trauma 全是编辑次数启发式（`editCount>=3`）的机械误报——从磁盘数据坐实了 `impact-measurement.md:43` 的「51 假 0 真」，不是设计文档声称，是 store 里真实躺着的脏数据。
- `neocortex.json`：**total_consolidated=0、last_consolidation=null**。巩固/长时转移从未运行，313 个事件全堆在短时缓冲。根因 = PM2 未装、daemon 未跑（`STATUS.md` 外部阻塞项），巩固靠 daemon 定时触发。
- `claims.json` total_claims=0、`claim-candidates.json` total_candidates=0。claim 层代码建好、11 条回归测试过，但 dogfood 里零使用——自动 producer 推迟（`truth-maintenance.md:110`）、手动 CLI 没人跑。
- `hippocampus.json` 的 `stats` 只有 7 个旧字段（total_events/reward/penalty/trauma/neutral/oldest/newest），没有新版 `types.ts:283-284` 的 `recurrences` / `negative_writes`——新探测器还没往这个 store 写过数据，schema 未回填。
- 正面（过程指标「健康」）：`token-ledger.json` 12 会话 repeated_reads_blocked=457、anatomy_hits=438、estimated_savings≈105 万 token；线索索引 `event_ids`=313 与 store 一致，漂移修复在真实安装里生效。

**五条教训**：(1) 过程指标健康 ≠ 结果指标有用，51 个假 trauma 就是「机制在跑但没学」的实锤；(2) 巩固与 claim 两个后半程子系统在 dogfood 里是**空转**的，加固只证明了前半程（store/索引/召回）稳；(3) 结果探测器要落地，先得回填 `recurrences`/`negative_writes` 字段并让 daemon 跑起来；(4) 退役编辑次数启发式是对的，但旧 store 里的 51 个 trauma 需要清理或标记；(5) `buglog.json` 已有 97+ 条，08-11 一天的高频自动修复（错误引用/缺守卫/空安全为主）说明加固阶段是「边吃狗粮边修」完成的。

## 第 10 节 · Kilo 现场安装 + 恢复会话缺口修复（2026-08-27）

| 我 | 你 |
|----|-----|
| 「install D:\GitRepo-AI\openwolf into kilo code」 | 先澄清「install into」三种解释（跑 `init --agent kilo` / vendor 进 `packages/` / npm 依赖），用户选「跑 `init --agent kilo`」。在 kilocode 仓库实跑，落盘 `.kilo/plugin/openwolf.ts` + `openwolf/` 10 文件、`.kilo/command/{reframe,security-audit}.md`、`.wolf/`（19 文件 + hooks/海马体）、AGENTS.md 标记块；附带 claude 副作用（`.claude/`、`CLAUDE.md`、central registry、pm2 未起）。Bun 实测插件可加载、`server()` 钩子键与 `@kilocode/plugin` Hooks 对齐 |
| 「我重启了，你能测试openwolf在当前kilo会话中生效了吗？」 | 第一次测试下错结论「半生效」——两个失误：①没做任何 read 前就查 `.wolf` 状态（`_session.json` 本应首次 read 才惰性建，`pre-read.ts:62`）；②读错计数器（看 `anatomy.md` 头部「hits: 0」，会话命中数在 `_session.json.anatomy_hits`） |
| 「sure」（同意埋点） | 给 `.kilo/plugin/openwolf/index.ts` 加 6 处 `dbg` 埋点写固定路径日志，验证可加载后清空 |
| 「retry again」（重启） | 读埋点日志，推翻上轮判断：**插件全量生效**（server 加载、事件流到达、工具钩子触发、system.transform 触发；live read 实测 `anatomy_hits` 4→5）。唯一缺口 = 恢复的会话不发 `session.created`（日志全程零条）→ `handleSessionStart` 被跳过 → `_session.json.session_id` 空串、`total_sessions=0`、`memory.md` 无头 |
| 「ok」（同意修兜底） | 修 openwolf 模板 `src/templates/kilo-plugin/index.ts`：`event` 对「首次 `session.updated` 且 `getSessionState` 为空」调 `handleSessionStart`（内存 Map 防重复启动）。重跑 `init --agent kilo` 重装（顺带冲掉埋点）。Bun 实跑三断言全过：1st `session.updated` 触发启动（session_id 落真实 id、total_sessions 0→1）、2nd 不重复、全新 `session.created` 1→2 |

**教训**：先埋点、后下结论。第一轮「半生效」是没实测就判的，两个失误（查态时机、读错计数器）都是静态臆断；埋点 + 重启实测立刻翻案成「全量生效、只剩一个缺口」。看计数器前先确认它是哪个计数器、由谁更新。

## 第 11 节 · 提交推送 + JOURNEY 全中文（2026-08-28 01:46）

| 我 | 你 |
|----|-----|
| git add push 到远程；要求 JOURNEY 更新且全部用中文写 | 检查 git 状态：本地目录 `.codex/` `.cursor/` `.opencode/` `.playwright-mcp/` 不提交；`.gitignore` 改动是 `docs/.vitepress/.temp/` 排除；`AGENTS.md` 是 openwolf 标记文件。把 JOURNEY 全中文化并补第 8/9 节，然后提交推送 |

## 第 12 节 · 结果测量基线重置（2026-08-27）

| 我 | 你 |
|----|-----|
| 复盘：hippo 现在只能证「机制健康」、证不了「有效果」，列三步（清 51 假 trauma / 装 PM2 回填字段 / 让探测器写 penalty），问怎么补 | 核对代码 + 读磁盘 store，修正一条：`recurrences`/`negative_writes` 字段代码里已接好线（`addEventToStore` 增 negative_writes、`post-write`→`recordRecurrence()` 增 recurrences、`normalizeStoreStats` 回填），缺的是信号流不是字段；三步塌缩成一步（清污染 + 重启活跃 dogfood） |
| 选「A」（整体重置） | 用生产序列化函数重置 hippocampus/neocortex/cue-index 到干净基线（备份到 `backup-pre-reset/`），保留 token-ledger 过程指标（457 读拦截 / 440 命中 / ~105 万 token） |
| 「继续开发不就是 dogfood 吗」 | 实测翻案：先用不存在文件 + `.wolf/` 文件测出「写路径没写」的误判，再拿真实源文件 `src/hippocampus/types.ts` 实测 → total_events 0→1，确认写路径是通的；`.wolf/*` 被 post-write 自引用守卫跳过是设计而非 bug |

**教训**：又一次「静态臆断 vs 实测」——和第 10 节「半生效」是同一病。诊断写路径是否活着，必须拿真实存在的 `src/**` 文件测，`.wolf/*`（守卫跳过）和不存在路径（resolveProjectPath 拒绝）都会给出假的「没写」信号。已记入 cerebrum Do-Not-Repeat。

## 第 13 节 · benchmark 全部 feature + 全量测试重写（2026-08-28~29）

| 我 | 你 |
|----|-----|
| 「rewrite test cases, or test cases are perfect? you need benchmark all features how grill me」 | 先读 `STATUS.md` + 跑 `pnpm test` 定位：108/1，唯一挂的是时间依赖测试 `token-measurement.test.ts:117`。按 grilling 逐条钉死 5 决策：Q1 三维度（覆盖/性能/效果，性能效果优先）、Q2 全部 feature、Q3 (A) 全量重写、Q4 单入口 `pnpm benchmark`、Q5 效果诚实报数不刷数 |
| 「a」「2. 全部 feature / 3. go all / 4 a / 5 a」 | 写 `docs3/benchmark-plan.md`，自批后改 v2：自动覆盖率因 src/dist 混导入失真（`tsconfig.hooks.json` 无 sourcemap）、性能分纯函数 vs 磁盘 I/O、中位数为准抗 GC、覆盖映射闸门防丢回归 |
| 「自我测试，如果test没有通过，修复，直到所有test通过」 | TDD 修 flaky：先改测试传固定 `now`（red `0 !== 1`），再给 `countSemanticEntries` 加 `now: Date = new Date()`（green）。`pnpm test` 109/109 |
| 「什么是代数 UI？这个 Open WF 项目应该没有 UI 才对」 | 纠正前提：OpenWolf 有 React dashboard（`src/dashboard/app/**` + `build:dashboard`），「代数 UI」不是标准术语。用户选 A 保留 dashboard（v1 只做 build 通过 + 文件存在性） |
| 「说人话」 | 把「诚实的边界」这类 jargon 打薄成大白话；后续报告压密度 |
| 「token 节省 1,151,042（真实读数）怎么计算的？」 | 追 `stop.ts:197-202`，**纠正自己的错**：1,151,042 不是真实读数，是估算——`anatomy命中×200`（200 拍脑袋）+ `Σ重复读文件token×(次数-1)`（token 按字符÷3.5/4/3.75）。真数据在 `real_input_tokens`≈6.07 亿那组 |
| 「我不理解省token是怎么工作的？」 | 讲机制：pre-read 钩子不拦读，只在读文件前往 stderr 插一句提醒（「读过了别重复读」/「这是摘要，用 offset 只读你要的」），省不省看 agent 听不听 |
| 「update readme journey and push to remote」 | 建 `benchmarks/*` harness（TDD red→green），`pnpm benchmark` 跑通：覆盖 51/186（27.4%、135 缺口）、性能基线（addMany 22.3ms 印证源码 ~16ms fsync 注释）、效果（token 估算 + recurrence_rate 0/0 标数据不足）；更 README/JOURNEY，提交推送 |

**教训**：① 估算 ≠ 实测，报数前追到代码看数字从哪来——这次「真实读数」是错的，被一句追问揪出；② grill 先钉死「benchmark 测什么」再动手，避开「大而空的活」；③ 时间依赖测试的根治是注入时钟，不是把测试改成碰运气。

## 这个项目如何教 vibe coding with AI

### 人的工作（决定 / 纠正 / 叫停）

- **把模糊需求钉成单一动作**——「install into kilo code」被拆成三种解释（跑 init / vendor 进 packages / npm 依赖），人拍板选「跑 `init --agent kilo`」，才落盘可验证（第 10 节）。
- **极短指令推进实测**——「sure」（埋点）、「retry again」（重启）、「ok」（修兜底）三个词，逼 AI 先埋点再下结论，而不是继续静态分析（第 10 节）。
- **坚持过程指标 ≠ 结果指标**——本次复盘那句「只能证机制健康、证不了有效果」，把 51 个假 trauma 的「机制在跑但没学」钉死，并拍板「整体重置」清脏数据（第 12 节）。
- **反复要求自批**——多次「自批 docs3/PLAN.md 并改进」「自批迁移文档」，把批评自己的产物当作常规工序，才挖出事件信封、goal driving 跨 prompt() 两个致命点（第 2、4、5 节）。

### AI 的工作（埋点 / 证伪 / 如实报告）

- **用磁盘数据证伪文档声称**——第 9 节读 `.wolf/*.json`，坐实「51 假 trauma / 0 真信号」（trauma=51、penalty=0、reward=0），推翻「影响测量已落地」的纸面说法。
- **承认误判并实测翻案**——第 10 节「半生效」是没实测就判的，埋点后翻案成「全量生效、只剩一个缺口」；第 12 节「写路径没写」同样被真实文件实测翻案。两次同病，AI 都主动认错并归因到「静态臆断」。
- **逐条核验「完成」声明**——第 6 节发现 PLAN 的「全绿」在盘上是假的（`handlePrecompact` 在 `_session.json` 缺失时注入了 `session_id`，测试期望 `{}`），修成 103/103 真绿。

### 可复用的规则

1. **先埋点/实测，后下结论**——第 10 节「半生效」和第 12 节「写路径没写」两次踩同一坑，都是没实测就判。诊断任何「活没活」，先拿真实输入跑一遍。
2. **磁盘数据 > 文档声称**——51 假 trauma 从 store 里读出来，才从「设计文档说的」变成「实锤」。
3. **一句纠正 → 固化 Do-Not-Repeat**——cerebrum 里大量 `[日期] Do not ...` 条目，是项目最高的复利：人只纠正一次，AI 永远不再犯。
4. **自批（critic）是承重件，不是洁癖**——kilo 事件信封（id 在 `properties` 不在顶层）、goal `driving` 集合跨 `prompt()`，都是自批阶段挖出的致命点，天真克隆/天真循环会静默空转。
5. **一坑两犯要升格**——post-write 误判和 kilo「半生效」是同一种「静态臆断」病，升格成 cerebrum Do-Not-Repeat，而不是当两次独立小失误。
6. **过程指标 ≠ 结果指标**——机制健康（store/索引/召回/拦截在跑）证不了有效果（agent 少犯错）。要结果，得先让负信号干净落地、再算复发率。

### 一句话总结

人负责钉死「做什么、改哪里、什么时候叫停」，AI 负责「埋点实测、证伪自己、把每句纠正固化成 Do-Not-Repeat」——这个项目就是这样从「机制能跑」一层层推到「能证明有效」的。

---

## 未决事项

- **Kilo 真实 dogfood 已跑**（`docs3/PLAN.md` 第 9 项，2026-08-27）：插件在真实 Kilo 里加载、`_session.json` 信封、空闲后 `token-ledger.json` 行均验证。顺带发现并修复**恢复会话不发 `session.created`** 的缺口（`src/templates/kilo-plugin/index.ts` 加 `session.updated` 兜底，内存 Map 防重复）。剩最后一步：用户再重启后确认 `total_sessions` 从 0 变 1 回传。
- **session.created 兜底未提交**：修复落在 `src/templates/kilo-plugin/index.ts`，与 kilo 适配器 WIP 同轨，未提交。
- **kilocode 仓库安装产物未入库**：`.kilo/plugin/`、`.kilo/command/{reframe,security-audit}.md`、`.wolf/`、`.claude/`、`CLAUDE.md` 均 untracked，`AGENTS.md` 被改（openwolf 标记块）。是否入库由 kilocode 仓库决定。
- **第二阶段延后**（hippocampus / `chat.message` / `bash` post-test、可见 warn 通道、`session.status` 空闲备份）。
- **第三阶段延后**（`src/runtime/` 共享运行时抽取，等 OpenCode 和 Kilo 都需 hippocampus/claims 对齐时再动）。
- **目标持久化在 kilocode，不在 openwolf**：进程重启后 re-arm（activation 进程内）、`BudgetLimited`、同条件 blocked 连续三次（需迁移）都未做；openwolf 插件侧目标行尚未集成。
- **`cli/index.ts` 的 survey 与 kilo 帮助混改**（评审记为卫生问题，未拆分提交）。
- **巩固在 dogfood 里从未运行**（`neocortex.json` total_consolidated=0）：PM2 未装导致 daemon 不跑，短时→长时转移、衰减、晋升全程空转。
- **claim 层零使用**（`claims.json` / `claim-candidates.json` 均 0 条）：自动 producer 推迟、手动 CLI 未跑，claim 语义只被测试覆盖，未被 dogfood 验证。
- **51 个假 trauma 已清理**（2026-08-27 整体重置）：编辑次数启发式留下的 51 个 `trauma`（penalty/reward 均为 0）连同 262 条 neutral 一并重置为干净基线，备份在 `backup-pre-reset/`，过程指标（token-ledger）保留。现在等真实负信号（user 纠正 / 测试失败）重新积累，复发率才有第一次干净分母。
- **全量重写 109 个测试未开始**（`docs3/benchmark-plan.md` P4）：按 TDD 质量标准（公共 seam、非 tautological、不绑定实现）重写 + 覆盖映射闸门防丢回归，是 benchmark 之后最大的活。
- **覆盖数 27.4% 是函数名 grep 下界**（低估间接覆盖）；精确行覆盖需 `pnpm benchmark --coverage`（默认关，避免二次跑全量测试）。
- **dashboard 函数级 UI 覆盖延后**（需 vitest+jsdom，v1 只做 build 通过 + 文件存在性）。
- **import 归一化延后**（src/dist 混导入使自动覆盖率失真，统一到 src 是侵入性改动）。
