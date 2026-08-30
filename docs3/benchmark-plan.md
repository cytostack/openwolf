# Benchmark + 全量测试重写计划

> 目标：用可重复的 benchmark 定量衡量 OpenWolf 实现的好坏（覆盖/性能/效果三维度），并把现有 109 个测试全量重写到 TDD 质量标准，同时用覆盖映射闸门证明"没丢回归保护"。
> 状态：待评审。评审通过后按第 5 节分阶段执行。

## 0. TL;DR

- 交付一个 `pnpm benchmark` 入口，跑三维度：**覆盖矩阵**（feature × 测试）、**性能基线**（热路径 ops/sec + 中位数延迟）、**效果读数**（token 节省 + recurrence_rate，诚实标数据不足）。
- 全量重写 109 个测试：按"公共 seam"重新推导，断言来源独立、不绑定实现；旧测试到新测试做**覆盖映射**，映射不闭合不删旧文件。
- 覆盖矩阵会暴露"哪些 feature 根本没测"，重写后重跑 benchmark 展示覆盖提升——这就是"实现好坏"的量化证据。

## 1. 成功标准（可验证）

1. `pnpm benchmark` 一条命令跑完三维度，写 `docs3/benchmark.md` + `benchmarks/baseline.json`，可重复、可对比趋势。
2. 覆盖矩阵覆盖 3.1 枚举的全部 seam；每个 seam 一行"已测/未测"状态，缺口清单明示。
3. 性能基线记录热路径操作（见 2.2）的 ops/sec 与中位数/p95 延迟，附运行条件（机器/Node v22.23.2/迭代次数）。
4. 效果读数：token 节省读 `token-ledger.json`（当前 1,151,042 tokens）；recurrence_rate 当前 0/0 → 报告"数据不足"，不刷数。
5. 重写后的测试套件：全绿、零时间依赖测试、每个测试都在公共 seam、断言不重算（非 tautological）、不绑定实现细节。
6. 覆盖映射（第 4.2 节）证明无能力丢失：每个旧测试在重写后套件里有归宿。

## 2. 三维度定义

### 2.1 覆盖（feature × 测试矩阵）

- **人工层（权威）**：一张 feature×测试映射表——3.1 每个 seam → 覆盖它的测试 → 状态（已测/未测）。这是"全部 feature"的答案，由人工阅读测试对 seam 清单得出。
- **自动层（佐证）**：`node --test --experimental-test-coverage`（Node v22.23.2 支持）。
- **自动层的已知失真**：现有测试混用两种导入——`src/hooks/*.ts`（原生 type-stripping 直接跑）和 `dist/**/*.js`（编译产物）。`tsconfig.hooks.json` 的 `dist/hooks` 编译无 sourcemap，`--experimental-test-coverage` 对 dist 加载的文件只能归到 dist、映不回 src。因此自动覆盖率只能作粗略数字，**以人工矩阵为权威**；import 归一化列为后续决策（见 §6）。

### 2.2 性能（热路径）

- **import 目标**：编译产物 `dist/`（生产实际运行物，与 hooks 运行时一致），不是 type-stripped 的 src。
- **目标操作**：
  - 纯函数（无 I/O，真实压测）：`calculateDecay`、`calculateConsolidationScore`、`determineConsolidationAction`、`scoreEvent`、`buildIndex`（内存态）
  - 带 I/O（临时目录隔离，结果标注"含磁盘 I/O"）：`addEventToStore`、`Hippocampus.addMany`、`runConsolidation`、`recallEvents`
  - claims：`recordClaim` / `approveCandidate`（按 `src/hippocampus/claims.ts`、`claim-candidate-store.ts` 实际导出名）
- **指标**：ops/sec + **中位数延迟为主**（抗 GC 尖峰），p95 作参考。预热 N 次 + 计时 M 轮，记录运行条件。首跑只建 baseline，不设绝对阈值。内存测量 v1 不做（噪声大），标记后续。

### 2.3 效果（outcome）

- **token 节省**：读 `token-ledger.json` lifetime + 每 session 趋势（`estimated_savings_vs_bare_cli`、`repeated_reads_blocked`、`anatomy_hits`）。
- **recurrence_rate**：读 `hippocampus.json` stats + `token-ledger.json` lifetime 的 `recurrences/negative_writes`。当前 0/0 → 输出"数据不足（dogfood 休眠）"。
- **探测器就绪性**：用单元测试证明 `detectCorrection`/`extractTestFailures`/`user-prompt`/`post-test` 能正确产出 penalty（并入 P5 测试重写，见 §5）。这是"数据一旦有就是真信号"的保证，不刷数。

## 3. Seam 清单（"全部 feature"）

### 3.1 源码域 → 公共 seam

| 域 | 模块 | 公共 seam（函数/类） |
|---|---|---|
| hippocampus 核心 | `event-store.ts` | `createEmptyStore, loadStore, saveStore, addEventToStore, getEventsByLocation, getTraumaEvents, getTraumaEventsForPath, filterEvents` |
| | `cue-index.ts` | `buildIndex, sortTraumaByIntensity, loadIndex, saveIndex, addEventToIndex, removeEventFromIndex, createEmptyIndex, indexNeedsRebuild` |
| | `cue-recall.ts` | `scoreEvent, scoreLocationMatch, computeRecencyScore, matchGlob, scoreStateMatch, recallEvents, getLocationCandidateIds, getQuestionCandidateIds, getStateCandidateIds, applyFilters` |
| | `consolidation.ts` | `createEmptyNeocortex, loadNeocortex, saveNeocortex, calculateDecay, calculateConsolidationScore, determineConsolidationAction, runConsolidation, getNeocortexEvents` |
| | `index.ts` | `Hippocampus`（含 `addMany`）、`createHippocampus` |
| | `persistence.ts` | 持久化/锁相关导出（按实际导出名） |
| claims 真值维护 | `claims.ts` | `recordClaim`(名待确认)、`recallClaims` 等 |
| | `claim-store.ts` | store 载入/保存/修复 |
| | `claim-index.ts` | index 派生/修复 |
| | `claim-candidate-store.ts` | candidate add/list/approve/reject/dedupe |
| hooks | `pre-read, post-read, pre-write, post-write, session-start, stop, shared, user-prompt, post-test, precompact` | 各自 `main` + `shared` 的 `countSemanticEntries, wasFileUpdatedSince, readTranscriptUsage, normalizePath` 等 |
| | `anatomy-store.ts, anatomy-lock.ts` | 载入/渲染/锁协议 |
| | `symbol-extractor.ts` | 各语言 extractor + 渲染 |
| buglog | `bug-tracker.ts, bug-matcher.ts` | `logBug, readBugLog, findSimilarBugs, searchBugs` |
| tracker | `token-estimator.ts, token-ledger.ts, waste-detector.ts` | `estimateTokens, readLedger, writeLedger, addSessionToLedger, detectWaste` |
| CLI | `index, init, update, scan, status, recall, claim, survey, report, registry, dashboard, daemon-cmd, cron-cmd, bug-cmd` | 各 `*Command` 函数 |
| daemon | `cron-engine.ts, file-watcher.ts, wolf-daemon.ts, health.ts` | `CronEngine`, `startFileWatcher`, 路由, `getHealth` |
| agents | `kilo.ts`（其余 opencode/cursor/codex/gemini/antigravity 按需） | `sessionIdOf`, `kiloAdapter.install`, `installSkills` |
| utils | `fs-safe, paths, platform, dashboard-auth, logger` | 各导出 |
| scanner | `anatomy-scanner.ts, description-extractor.ts, project-root.ts` | `scanProject, buildAnatomy, extractDescription, findProjectRoot` |
| dashboard UI | `src/dashboard/app/**` | 见 §6 边界 |

### 3.2 现状（重写前）

- `pnpm test` = 12 个测试文件，109 用例，108 过 / 1 挂。
- 挂的是 `tests/token-measurement.test.ts:117`，时间依赖（墙钟耦合，见 `src/hooks/shared.ts:654,670`）。
- dashboard UI 无单元测试（无 `.test.ts`）；CLI 命令多为进程级 spawn 测。
- 导入策略混杂：`src/hooks/*.ts`（type-strip）+ `dist/hooks/hippocampus/*.js`（hooks 编译，无 sourcemap）+ `dist/src/**/*.js`（主编译，有 sourcemap）。

## 4. 测试重写方法

### 4.1 质量标准（每个新测试必须满足）

- 在公共 seam 测行为，不测私有方法、不 mock 内部协作者、不通过文件副作用侧信道断言。
- 断言期望值来自独立来源（字面量、手算样例、规范），**不**用与实现相同的算法重算。
- 测试名读起来像规格说明（"recall repairs a stale persisted index"，而非"testRecallFunction"）。
- 零时间依赖：不读墙钟的测试数据，或把 `now` 注入。
- 不弱化断言：不用 `toBeDefined`/`toBeTruthy` 代替真值；不 mock 掉被测逻辑本身。
- 红检：green 之后故意改坏行为（改个运算符、反转条件），测试必须变红；不红 = 没在测，重写。

### 4.2 覆盖映射闸门（防丢回归）

重写前，对每个旧测试文件建**测试级**映射：`旧测试名 → 新测试名/文件`。规则：
- 映射未闭合（旧测试找不到新归宿）前，**不删旧文件**。
- 每个旧测试文件重写完成、映射闭合、新旧都绿后，才移除旧文件。
- 最终输出一张映射表进 `docs3/benchmark.md` 附录，作为"无能力丢失"的审计证据。
- 文件组织**保留现状**（12 个文件已对齐 seam），重写的是断言质量 + 补缺口，不打乱结构。

### 4.3 flaky 修复

根因：`countSemanticEntries` 用真实墙钟（`src/hooks/shared.ts:650` `now = new Date()`，`:654` `currentMinutes`，`:670` 过滤），测试硬编码 17:34/17:35。
修复：给 `countSemanticEntries` 增加可选 `now: Date` 参数（默认 `new Date()`，与现有 `sessionStarted` 可选参数风格一致），测试传固定时间；重写该测试为时间无关。

### 4.4 TDD 适用点

- benchmark harness（新代码）：先写 harness 的 red 测试，再 green。
- flaky 修复：先写"注入 now 后计数稳定"的 failing 测试，再改实现。
- 测试重写本身是"从行为重新推导"，非 red-green（实现已存在），用覆盖映射闸门替代 red-green 保障。

## 5. 执行阶段（每阶段带验证）

- **P0 基线冻结**：记录当前 `pnpm test` 结果（108/1）、`git status` 干净基线、Node v22.23.2 + 导入策略事实。验证：`pnpm test` 复现 108/1。
- **P1 benchmark harness 骨架**：`benchmarks/` 目录、`pnpm benchmark` script、`baseline.json` schema、三维度 runner（TDD：先 red 后 green）。验证：harness 单测绿。
- **P2 覆盖基准**：生成人工 feature×测试矩阵与缺口清单 + 自动覆盖率（附失真 caveat）。验证：矩阵覆盖 3.1 全部 seam。
- **P3 性能基准**：实现热路径压测（纯函数/I/O 分离、中位数为主），记录 baseline。验证：`baseline.json` 有 ops/sec + 中位数/p95。
- **P4 全量测试重写**：按 4.1 逐文件重写，覆盖映射闸门随行；含 flaky 修复（TDD）与探测器就绪性单测。验证：全绿、零时间依赖、映射闭合。
- **P5 重跑 + 报告**：重写后重跑三维度，生成 `docs3/benchmark.md`（含前后对比）。验证：覆盖提升有数据支撑。
- **P6 收尾**：`git diff --check`、更新 STATUS.md / cerebrum.md / anatomy.md、JOURNEY.md。

## 6. 边界与待确认

- **dashboard UI**：当前测试栈是 `node --test`，无法直接跑 React 组件（需 vitest+jsdom+testing-library，属规模扩张）。本计划 v1 把 dashboard 覆盖定义为"`pnpm build:dashboard` 通过 + 组件文件存在性"，不做函数级 UI 测试；函数级 UI 测试标记后续阶段。**（待用户确认）**
- **import 归一化**：让所有测试统一 import src（需把内部用 `.js` specifier 的源文件改成 type-stripping 可解析），是独立的侵入性源改动，**不在本会话范围**，列为后续决策。
- **CLI 命令**：函数级 = 直接 import `*Command` 函数测，进程级 = spawn。默认直接 import 函数；需要进程级验证的（daemon/dashboard 端口）单独 spawn。
- **claims seam 名**：`recordClaim` 等导出名以源码实际为准（`src/hippocampus/claims.ts` 已见 `recallClaims` L407；record 侧待实现时核对）。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重写丢断言/丢覆盖率 | 覆盖映射闸门（4.2），映射不闭合不删旧文件 |
| 性能数据噪声（GC/机器状态） | 中位数为主 + 预热 + 记录运行条件；I/O 操作隔离到 tmp 并标注 |
| 自动覆盖率失真（src/dist 混导入、hooks 无 sourcemap） | 人工矩阵为权威，自动层只作佐证并标注失真 |
| 效果读数 0/0 显得"没产出" | 明确交付"探测器就绪性证明 + 诚实空读数"，不刷数 |
| dashboard 函数级覆盖缺位 | 边界声明 + 后续阶段，不静默跳过 |
| 全量重写工期长 | 按 3.1 分域逐文件推进，每域闭环再进下一域 |

## 8. 交付物

- `benchmarks/` 源码（runner + 各维度实现）
- `pnpm benchmark` script（package.json）
- `docs3/benchmark.md`（含覆盖矩阵、性能基线、效果读数、前后对比、覆盖映射附录）
- `benchmarks/baseline.json`（可重复、可趋势对比）
- 重写后的 `tests/*.test.ts`（全绿、零时间依赖）
- 更新：STATUS.md、cerebrum.md（Do-Not-Repeat 记"测试不得读墙钟"）、anatomy.md、JOURNEY.md
