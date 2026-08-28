# 协作记录（JOURNEY）— openwolf

> 两列进度日志，自顶向下按时间序（旧→新）。「我」= 人（动作/提问），「你」= AI（响应）。
> 尾部「未决事项」为待办。
> 来源范围：`kilo_local_recall` 只覆盖 2026-08-25 起的 9 个会话（kilo 迁移 / 目标 / 面经）。08-11 的海马体开发与 08-25~26 的影响测量开发，会话转录不在本地 recall 中——下面这两段据 `STATUS.md` + `git log` + `docs2/` 重建，是事实时间线，不是逐条对话。

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

## 第 10 节 · 提交推送 + JOURNEY 全中文（2026-08-28 01:46）

| 我 | 你 |
|----|-----|
| git add push 到远程；要求 JOURNEY 更新且全部用中文写 | 检查 git 状态：本地目录 `.codex/` `.cursor/` `.opencode/` `.playwright-mcp/` 不提交；`.gitignore` 改动是 `docs/.vitepress/.temp/` 排除；`AGENTS.md` 是 openwolf 标记文件。把 JOURNEY 全中文化并补第 8/9/10 节，然后提交推送 |

---

## 未决事项

- **Kilo 真实 dogfood 未跑**（`docs3/PLAN.md` 第 9 项）：插件在真实 Kilo 里加载、`_session.json` 信封、空闲后 `token-ledger.json` 行——这是唯一未验证的第一阶段项，手动步骤，不属代码缺口。
- **第二阶段延后**（hippocampus / `chat.message` / `bash` post-test、可见 warn 通道、`session.status` 空闲备份）。
- **第三阶段延后**（`src/runtime/` 共享运行时抽取，等 OpenCode 和 Kilo 都需 hippocampus/claims 对齐时再动）。
- **目标持久化在 kilocode，不在 openwolf**：进程重启后 re-arm（activation 进程内）、`BudgetLimited`、同条件 blocked 连续三次（需迁移）都未做；openwolf 插件侧目标行尚未集成。
- **`cli/index.ts` 的 survey 与 kilo 帮助混改**（评审记为卫生问题，未拆分提交）。
- **巩固在 dogfood 里从未运行**（`neocortex.json` total_consolidated=0）：PM2 未装导致 daemon 不跑，短时→长时转移、衰减、晋升全程空转。
- **claim 层零使用**（`claims.json` / `claim-candidates.json` 均 0 条）：自动 producer 推迟、手动 CLI 未跑，claim 语义只被测试覆盖，未被 dogfood 验证。
- **51 个假 trauma 脏数据待清理**：编辑次数启发式在 store 里留下了 51 个 `trauma`（penalty/reward 均为 0），退役启发式后需清理或标记，避免污染未来复发率分母。
