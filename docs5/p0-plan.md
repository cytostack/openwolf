# P0 实施计划（goal / test / spec）— 已按 critic 核验修订

> 对应 `docs5/brainstorm-100.md` 的 18 条 P0。每条 = goal + test + spec，锚点对齐 HEAD `f25748b`（已用 Grep/Read 逐条核验，不再照搬 brainstorm 记忆）。
> **审后纪律**：每条 spec 先标注现状（已实现未测 / 未实现 / 需决策），禁止把"已实现未测"写成"待实现"；测试里的类型名、字段名与 `types.ts` / `EVIDENCE_WEIGHTS` 逐字相同。
> 本轮已核验并修正的错锚点：`schema_version` 已存在（非从零发明）、事件 ID 已用 `crypto.randomUUID`（非待实现）、`isSensitiveFile` 吃 basename（非路径）、cron 无阶段机（非 agent 流水线）、`EVIDENCE_WEIGHTS` 是 kebab、`estimateTokens` 有 5 份拷贝、`outcome` 两套公式、STATUS 是叙事源。

---

## P0-1. 事件 store 的 schema 迁移（bump 1→2）

- **现状**：`schema_version: 1` 已存在于 `types.ts:146/200/270`（三个 store 类型）、`event-store.ts:19`（`createEmptyStore`）、`claim-store.ts`、`claim-candidate-store.ts`、`consolidation.ts` 共 10 处。`is_recurring`/`first_event_id` 已从 src 删干净，但磁盘上的旧 store 数据里可能还带着这两个字段，靠 JSON 宽容性共存（僵尸字段）。`normalizeStoreStats`（`event-store.ts:54-62`）只回填 `recurrences`/`negative_writes`，**不删死字段**。
- **goal**：第一次真迁移 = bump `schema_version` 1→2，迁移函数幂等剥离旧事件里的 `outcome.is_recurring`/`outcome.first_event_id`，并对未知字段告警。不虚构"从零加 schema_version"。
- **test**：红——fixture 用磁盘真实旧 store（或从 git 历史 `07e78cc` 前后取样），断言 `loadStore` 触发迁移、遗留字段被剥离、且迁移幂等（load 两次结果一致）。绿——实现迁移链后通过。
- **spec**：
  - `event-store.ts:41 loadStore` 检测 `schema_version`，低于当前版本跑迁移链。
  - 迁移函数列表：`v2` = 剥离 `outcome.is_recurring`、`outcome.first_event_id` + 写告警日志。
  - 未知字段告警：迁移时对不在当前 schema 的字段报 warn，不静默吞。
  - 锚点：`event-store.ts:19`（已有 version 写入）、`:41 loadStore`、`:54 normalizeStoreStats`。

## P0-5. 修 `turn_in_session` 硬编码 0（含并发）

- **现状**：`post-write.ts:276` / `user-prompt.ts:55` / `post-test.ts:79` 全写 `turn_in_session: 0`；`trajectory.ts:11` 注释已承认"顺序靠 timestamp 重建，因为 turn_in_session 没填"。
- **goal**：事件有真实的"第几步"，让 trajectory 排序不依赖 timestamp（同毫秒会错序）。
- **test**：红——多事件序列断言同 session 的 `turn_in_session` 严格递增、跨 session 各自从 1 计。**加并发断言**：两个 hook 进程同时 +1 不得撞号（critic 指出单进程递增在多进程 hook 下会丢号）。
- **spec**：
  - 候选 A：store 内单调序号（`addEventToStore` 或 `Hippocampus` 维护 per-session 计数，不依赖 `_session.json` 的读写竞争）。
  - 候选 B：`_session.json` 加 `turn_count` + 锁内递增。
  - 选 A 更稳（store 是权威、有锁），`_session.json` 只是指针不是计数器。
  - 锚点：`post-write.ts:276`、`trajectory.ts:11`。

## P0-15. evidence 排序回归测试（对齐真实类型名）

- **现状**：`EVIDENCE_WEIGHTS` 是 **kebab-case**：`automated-test:1` → `reproducible-observation:0.95` → `direct-tool-result:0.85` → `explicit-user-correction:0.75` → `verified-code-inspection:0.65` → `agent-inference:0.35` → `unverified-assumption:0.15`（`claims.ts:16-24`）。`evidenceStrength = EVIDENCE_WEIGHTS[quality] * provenance.authority`（`claims.ts:126-128`），是**乘积**不是只看 quality。
- **goal**：锁定证据排序语义，防改坏。
- **test**：红/绿——① 钉 `EVIDENCE_WEIGHTS` 七个 key 的顺序（逐字 kebab）；② `authority` 相同时 `automated-test` 排 `agent-inference` 前；③ `authority` 不同时按乘积（如 `agent-inference × 1.0` vs `automated-test × 0.5`）排。不要写"自动化测试 / 推理"这种对不上 union 的中文词。
- **spec**：`recallClaims` 的排序若走 `evidenceStrength`，测试锁住它；若走别的，先定位真实排序点。
- 锚点：`claims.ts:16-24`、`:126-128`、`recallClaims`（`claims.ts` 内）。

## P0-16. token 估算校准（明确校准哪一份）

- **现状**：`estimateTokens` 有 **5 份拷贝**：`shared.ts:606`、`tracker/token-estimator.ts:20`、`scanner/anatomy-scanner.ts:49`、`templates/kilo-plugin/fs.ts:61`、`templates/opencode-plugin/fs.ts:61`。字符÷常数的启发式。
- **goal**：校准系数，让"省 1M token"这个 outcome 数字有可信度。
- **test**：红——取真实文件样本用真实 tokenizer 算真值，断言 `estimateTokens` 误差 < 阈值。绿——校准后通过。
- **spec**：
  - 先定"校准哪一份是 canonical"（hook 侧走 `shared.ts:606`），明确插件副本（`fs.ts:61`）是否同步改——插件事 self-contained，不能 import src，改系数要 5 处同步（或接受漂移并记录）。
  - 校准数据（样本 + 真值 + 系数）落到 `docs3/`。
  - 锚点：`shared.ts:606`（canonical）、`token-estimator.ts:20`、`fs.ts:61` ×2。

## P0-19. 消除 STATUS / specs-state 双源漂移（SSOT 方向修正）

- **现状**：cerebrum/STATUS 已拍板"**长期任务复用 `.wolf/STATUS.md`，`specs-state.json` 只是工作指针**"。`status-check.ts` 现在只 warn。
- **goal**：消除漂移，但方向是 STATUS 仍是叙事源、CLI 只生成/校验 **active spec 那一小段**，不把手写进度覆盖成 spec 指针。
- **test**：红——断言 `openwolf spec status` 写回 STATUS.md 后，"active spec" 段与 `specs-state.json` 一致，且其余手写进度段不被破坏。
- **spec**：
  - `src/specs/status-check.ts` 从 warn 升级为"生成/校验 active spec 段"，写入范围只限 STATUS.md 里被标记的那一小段。
  - 先和 cerebrum 决策对齐（STATUS 是叙事源），再写测试。
  - 锚点：`status-check.ts`、`specs-state.json`。

## P0-29. ai_task 的 human-in-the-loop 护栏

- **现状**：cron 的 `runAction`（`cron-engine.ts:211-234`）分发 5 种 action：`scan_project`/`consolidate_memory`/`consolidate_hippocampus`/`generate_token_report`/`ai_task`。**只有 `ai_task` 涉及 agent**（`runAiTask` spawn Claude CLI，`:328`）。无 HITL 概念。
- **goal**：`ai_task` 是唯一需要护栏的执行面——执行前检查 `human_gate` 清单，命中则挂起等人批。
- **test**：红——cron 任务 `action.params.human_gate` 命中时，断言任务不执行而是写"待审批"状态到 `cron-state.json`。绿——实现后通过。
- **spec**：护栏加在 `runAiTask` 或 `executeTask` 外层，不动其它 4 个确定性维护动作。
- 锚点：`cron-engine.ts:229-231`（ai_task 分支）、`:328 runAiTask`。

## P0-30. ai_task 预算/超时封顶

- **现状**：`runAiTask` spawn Claude CLI 后无超时控制，可能无限跑。
- **goal**：给 `ai_task` 加 timeout/预算，超限 kill 子进程并记 failed。
- **test**：红——构造一个超时 task，断言超限后被 kill、`execution_log` 记 failed + 超时原因。绿——实现后通过。
- **spec**：`CronTask.action.params` 加 `timeout_ms`；`runAiTask` 的 spawn 加超时 kill。不加"轮数/token 预算"（Claude CLI 子进程不暴露这些，加就是画饼）。
- 锚点：`cron-engine.ts:328 runAiTask`。

## P0-31. verifier —— **从 P0 移除**

- **现状**：`CronTask`（`cron-engine.ts:11-25`）是 `action:{type,params}` + retry/failsafe，`ExecutionEntry.status` 只有 `success|failed`（`:32-37`），**没有 implement→review→verify 阶段**。verifier 是"agent 流水线"概念，OpenWolf cron 是"定时跑动作"，无处挂。
- **处置**：从 P0 拿掉。若未来做真正的多 agent 流水线，再另开模块（不在 cron 上画不存在的阶段）。P0 净减 1 条（剩 17 条）。

## P0-39. CI 跑行覆盖率 + 设门槛

- **现状**：`benchmarks/coverage.ts:44 automatedLineCoverage` 已实现（`node --test --experimental-test-coverage`），但默认不跑、无 CI 接线。
- **goal**：CI 里跑覆盖率并设下限，防回归。
- **test**：验收 = `.github/workflows/` 加覆盖率 job，低于基线即红（先跑一次 `--coverage` 取当前实测基线）。
- **spec**：加 workflow 文件，跑 `node --test --experimental-test-coverage tests/*.test.ts` + 解析 `All files` 行。
- 锚点：`coverage.ts:44`、`.github/workflows/`。

## P0-41. outcome 公式测试（拆两套公式）

- **现状**：**两套公式**：`index.ts:846-848` = `negative_writes > 0 ? recurrences/negative_writes : 0`（store 侧，返回 0）；`benchmarks/outcome.ts:63` = `insufficient ? null : round3(recurrences/negative_writes)`（benchmark 侧，返回 null）。`tests/hippocampus-hardening.test.ts:178/615/621` 已测 store 侧的 0 和 1。
- **goal**：别写"公式没测过"——store 侧已测。真正的空档是 benchmark 侧 `collectOutcome` 的合成数据路径。
- **test**：红/绿——① 合成 store（`recurrences=2, negative_writes=4`）断言 benchmark `recurrence_rate = 0.5`、`insufficient_data = false`；② `negative_writes=0` 断言 `recurrence_rate = null`、`insufficient_data = true`。两个断言，别合成一条。
- **spec**：`collectOutcome` 抽纯函数 `computeOutcome(stats, lifetime)` 可注入合成数据。
- 锚点：`outcome.ts:46-65`、`index.ts:846-848`。

## P0-50. 去重 `copyHookScripts`（行号修正）

- **现状**：`init.ts:658` 和 `update.ts:448` 各一份。update 清单缺 `user-prompt.js` + `post-test.js`（`update.ts:466-470` vs `init.ts:679-693`）——这个 bug 判断对。
- **goal**：抽一份共享实现，两份不再漂。
- **test**：红——断言 `init` 和 `update` 产出的 `.wolf/hooks/` 文件清单完全一致（都含 `user-prompt.js`/`post-test.js`）。绿——去重后通过。
- **spec**：抽 `src/cli/copy-hooks.ts` 共享模块，hook 清单只一份；顺带把 hippocampus 拷贝差异一并收口。
- 锚点：`init.ts:658`、`update.ts:448`。

## P0-53. Windows 崩溃一致性验证

- **现状**：原子写靠 sibling-temp + fsync + rename（`src/utils/fs-safe.ts writeJSON`、`src/hippocampus/persistence.ts`），Windows 上 fsync 语义不同。
- **goal**：验证/补 Windows 崩溃一致性，确保 store 无半写态。
- **test**：红——写一半 kill 进程（或模拟断电），断言恢复后 store 要么旧值要么新值，绝无半写。绿——若需补 `FlushFileBuffers` 语义则补后通过。
- **spec**：验证 `fs-safe.ts` 的 `writeJsonAtomic` 在 Windows 上是否足够，不足则补 fsync/FlushFileBuffers。
- 锚点：`fs-safe.ts`、`persistence.ts`。

## P0-58. 并发写不丢事件 —— **已证伪 / 降级（2026-08-31）**

- **结论**：锁是对的，不丢事件。critic 的"读改写覆盖丢事件"推测被证伪。
- **证据**：`addEvent`/`addMany` 的 `loadStoreOrCreate → addEventToStore → saveStore` 全程在 `withHippocampusLock` 内（`index.ts:426-441`、`:480-495`）。新增回归测试 `tests/hippocampus-hardening.test.ts` `"concurrent writers each adding N events lose none"`——8 进程各写 10 个事件（80 次独立锁竞争），断言 `buffer.length === 80`、无重复 ID、index 一致；**5 次全绿，全套 169/169**。
- **处置**：P0 降级。事件 ID 已是 `crypto.randomUUID()`（`index.ts:414/468`）无需改；锁粒度无需改。更严的并发测试保留作回归锁（原测试只覆盖"各写 1 个"）。

## P0-60. 敏感路径（先列允许表，再决定扩不扩 API）

- **现状**：`isSensitiveFile(basename: string)`（`shared.ts:143`）吃 **basename**，不是路径；`.env.local` 已被 `.env.` 前缀拦（`post-write.ts:80` 调 `isSensitiveFile(baseName)`）。"改成白名单默认拒绝"会误杀大量合法写（`.wolf/cerebrum.md` 之外还有别的）。
- **goal**：凭证/密钥不进记忆，且不误杀合法写。
- **test**：先列"允许写进记忆的路径表"（`.wolf/`、`src/`、`tests/`、`docs*/` 等），断言表内放行、表外拒绝。再决定现有 basename 黑名单够不够。
- **spec**：
  - 先产出路径表，再决定 `isSensitiveFile` 是否扩成路径级 `isSensitivePath`（吃全路径，能查目录白名单）。
  - 若现有 basename 黑名单已覆盖凭证场景，则 P0 降级为"补漏网项"而非重构。
  - 锚点：`shared.ts:143 isSensitiveFile`、`post-write.ts:80`。

## P0-61. 主动 credential 检测

- **现状**：事件内容无高熵串检测，token/密钥可能进记忆。
- **goal**：写事件前扫描并脱敏。
- **test**：红——写含 `sk-...`/高熵串的 reflection，断言入库前被 `[redacted]` 替换。绿——实现后通过。
- **spec**：`post-write.ts` 写事件前对 `reflection`/`description` 跑正则 + 熵检测。
- 锚点：`post-write.ts` 的 `addEvent` 调用前（`:265` 附近）。

## P0-79. 统一事件 envelope 抽象

- **现状**：`sessionIdOf` 差异已踩坑（Claude `event.session_id` / Kilo `properties.info.id` / OpenCode top-level）。
- **goal**：抽 `canonicalSessionId(event)` 统一入口。
- **test**：红——构造三种 harness 的 envelope，断言 `canonicalSessionId` 都抽出同一 session id。绿——实现后通过。
- **spec**：新模块 `src/agents/session-id.ts` 暴露 `canonicalSessionId`；`kilo.ts sessionIdOf`、opencode plugin 调它，各 harness 只写适配分支。
- 锚点：`src/agents/kilo.ts`、`src/templates/kilo-plugin/`。

## P0-86. outcome 测量 —— **移出 TDD 票，进运行期清单**

- **现状**：`recurrences/negative_writes = 0/0`（dogfood dormant）。这是运维目标，不是红绿可测的代码项。
- **处置**：从实施表移除，挪到运行期清单（STATUS.md 下一阶段已在）。代码侧只留 P0-41（公式测试）。P0 净减 1 条（剩 16 条）。

## P0-92. `openwolf doctor` 记忆体检（第一批检测项修正）

- **现状**：死字段 `is_recurring`/`first_event_id` 在源码已不存在，doctor 的"死字段检测"会空跑。
- **goal**：自动检测真实存在的健康问题。
- **test**：红——构造一个带"cue-index 与 store 漂移 + STATUS/spec 漂移 + init/update hook 清单不一致"的 `.wolf/`，断言 doctor 逐项报出。
- **spec**：doctor 第一批钉：① `cue-index.ts indexNeedsRebuild`（已有逻辑）；② STATUS.md 与 specs-state 漂移（复用 `status-check.ts`）；③ update/init hook 清单不一致（P0-50 的产物）。
- 锚点：`cue-index.ts indexNeedsRebuild`、`status-check.ts`、`cli/index.ts createProgram`（加子命令）。

---

## 附：P0 修订后清单与顺序

- **净变化**：P0-31（verifier）、P0-86（outcome 测量）移出 TDD 实施表 → **P0 代码项从 18 条变 16 条**。
- **可立即独立做（无依赖，7 条）**：P0-50（copyHookScripts 去重，已是 bug）、58（锁粒度）、60（先列路径表）、61（credential 检测）、15（evidence 回归锁）、41（outcome 公式测试）、39（CI 门槛）。
- **有前置依赖**：P0-5（需先定 store 单调序号方案）、P0-1（需先定 bump 策略 + 取旧 store fixture）、P0-92（聚合多项检测，依赖 P0-50 产物）。
- **需运行期/外部条件**：P0-53（Windows 崩溃环境）、P0-29/30（ai_task 护栏，需真实 Claude CLI）。
- **需决策**：P0-19（SSOT 方向——STATUS 是叙事源已定，只待定"生成范围"）、P0-79（envelope 抽象放哪层）、P0-60（是否扩成 isSensitivePath）。

> 每条 P0 都可在独立 worktree/session 里 TDD 推进。开工前先 Grep 符号确认"已实现 vs 待实现"，是本轮 critic 换来的硬纪律。
