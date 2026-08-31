# OpenWolf 100 任务规划（P0 → P1 → P2）

> 由 `docs5/brainstorm-100.md` 的 100 条建议转成可执行 task。编号 `#N` 与 brainstorm 的 `N` 号一一对应。
> 状态：`pending`（未开始）/ `in-progress` / `done` / `cancelled` / `runtime`（运行期，非 TDD）。
> 验收标准 = 每条 task 的"红→绿测试 + 提交"（P0 详列；P1/P2 只给一行标题，验收见 brainstorm 原文）。

---

## P0（18 条 → 15 条活跃 TDD + 1 done + 1 cancelled + 1 runtime）

| # | 任务 | 状态 | 依赖 | 验收（红→绿） |
|---|---|---|---|---|
| 5 | turn_in_session 序号（方案 A，锁内扫 buffer max+1 + trajectory 两侧同步排序） | **in-progress**（plan v2 已过 critic） | 无 | 同 session `[1,2,3]`；跨 session 各自从 1；2 进程×5→`1..10`；trajectory 历史+查询两侧按 turn；契约测试（传 99 被覆盖） |
| 50 | 去重 `copyHookScripts`（init.ts/update.ts 抽共享模块） | pending | 无 | `init` 与 `update` 产出 `.wolf/hooks/` 清单一致（都含 user-prompt.js/post-test.js） |
| 58 | 并发写不丢事件 | **done**（`c2f2bba`，证伪：锁正确，8×10 事件 5 次全绿） | — | — |
| 15 | evidence 排序回归测试 | pending | 无 | 钉 `EVIDENCE_WEIGHTS` 7 个 kebab key 顺序；authority 相同/不同两种乘积 |
| 41 | outcome 公式测试（两套：store=0 / benchmark=null） | pending | 无 | 合成 store 断言 rate=0.5 / insufficient=false；0 分母断言 null / true |
| 39 | CI 跑行覆盖率 + 门槛 | pending | 无 | workflow 加 `--coverage` job，低于基线红 |
| 61 | credential 检测脱敏 | pending | 无 | 含 `sk-`/高熵串的事件入库前 `[redacted]` |
| 60 | 敏感路径（先列允许表，再定 API） | pending | 无 | 表内放行/表外拒绝 |
| 1 | schema 1→2 迁移（剥离死字段 + 未知字段告警） | pending | 需取旧 store fixture | 旧 store 含 is_recurring/first_event_id 加载后被剥离 + 幂等 |
| 16 | token 估算校准（5 份拷贝的 canonical） | pending | 无 | 真实 tokenizer 对照误差 < 阈值 |
| 19 | 双源漂移 SSOT（STATUS 叙事源，CLI 只生成 active spec 段） | pending | 需决策生成范围 | `spec status` 写回后 active spec 段与 specs-state 一致且不破坏手写进度 |
| 79 | 事件 envelope 统一（canonicalSessionId） | pending | 需决策放哪层 | 三种 harness envelope 抽出同一 session id |
| 92 | `openwolf doctor`（cue-index/漂移/hook 清单） | pending | 依赖 #50 产物 | 构造病态 `.wolf/` 逐项报出 |
| 29 | ai_task HITL 护栏 | pending | 需 Claude CLI | human_gate 命中挂起写 cron-state |
| 30 | ai_task 预算超时 | pending | 需 Claude CLI | 超限 kill + 记 failed |
| 53 | Windows 崩溃一致性 | pending | 需 Windows 崩溃环境 | 写一半 kill，恢复后无半写态 |
| 31 | verifier 角色 | **cancelled**（cron 无阶段机，另开模块再说） | — | — |
| 86 | outcome 测量 | **runtime**（运维目标非 TDD，挪运行期清单） | — | — |

---

## P1（53 条）

| # | 任务 | # | 任务 |
|---|---|---|---|
| 2 | recall MMR 去重 | 7 | 衰减注入时钟 |
| 8 | question/state 死索引清理 | 9 | claim scope 父目录匹配 |
| 10 | trauma evict 总上限 | 11 | 遗忘可观测 |
| 18 | pre-read claim relevance 排序 | 20 | memory.md 去重压缩 |
| 22 | 拆大文件 | 26 | 隔离自治实现运行 |
| 27 | orchestrator + 子 agent | 28 | worktree + auto-merge |
| 32 | SDD 失败回退 | 33 | 跨 harness 事件总线 |
| 36 | 失败回 plan 机制化 | 37 | 长任务 checkpoint |
| 38 | 清 138 coverage gap | 40 | mutation testing |
| 42 | perf 回归门槛 | 43 | flaky 检测 |
| 44 | 测试 build 前置 | 45 | 端到端全链测试 |
| 47 | seams.json 自动生成 | 48 | 期望值独立 lint |
| 49 | CLI smoke 测试 | 51 | 锁 owner 心跳 |
| 52 | 增量 vs 全量校验 | 54 | fail-open 留痕 |
| 55 | 跨进程竞争测试 | 56 | size_bytes 口径一致 |
| 57 | 备份损坏路径 | 59 | store 数据迁移脚本 |
| 62 | 记忆删除权 forget | 63 | dashboard auth 验证 |
| 64 | 绝对路径脱敏 | 66 | 夜跑权限最小化 |
| 67 | audit 进 CI | 68 | 统一 JSON schema |
| 69 | 退出码统一 | 70 | dashboard claim 操作 |
| 73 | update breaking 检查 | 75 | 多项目健康概览 |
| 78 | Kilo plugin 拷贝去重 | 80 | OpenWolf goal 行决策 |
| 81 | 事件 ID 语义统一 | 82 | 插件加载失败可见性 |
| 83 | 跨 harness 记忆共享验证 | 87 | 复发归因细化 |
| 88 | A/B 对照 | 89 | 反馈闭环可测 |
| 90 | token 节省对照 | 91 | 学习回收率 |
| 97 | 死代码审计 | — | — |

## P2（29 条）

| # | 任务 | # | 任务 |
|---|---|---|---|
| 3 | candidate 队列健康度 | 4 | trajectory 参数可配 |
| 6 | neocortex 语义检索 | 12 | 消费 recent_errors |
| 13 | 跨 session 轨迹 | 14 | 跨项目经验回传 |
| 17 | anatomy 折叠 | 21 | token 实时仪表 |
| 23 | JOURNEY/memory 分工 | 24 | skill 懒加载 |
| 25 | 摘要缓存过期 | 34 | cron 优先级/依赖 |
| 35 | 结构化 handoff | 46 | benchmark 迭代自适应 |
| 65 | sensitive 拒绝留痕 | 71 | shell completion |
| 72 | 非交互 init | 74 | 日志分级 |
| 76 | daemon 日志过滤 | 77 | designqc 跨 harness |
| 84 | hook 特性检测 | 85 | 插件版本解耦 |
| 93 | 警告转化率 | 94 | 标准记忆评估 |
| 95 | claim 采纳回测 | 96 | docs 目录索引 |
| 98 | AGENTS/CLAUDE 单一来源 | 99 | 收紧 Record<any> |
| 100 | 依赖精简 | — | — |

---

## exec 顺序（P0，无依赖优先）

1. **立即可做（7 条）**：#5（in-progress）、#50、#15、#41、#39、#61、#60
2. **有依赖/决策（8 条）**：#1（旧 store fixture）、#16、#19、#79、#92（依赖 #50）、#29、#30、#53（需外部环境）

**P0 总活跃 = 15 条**（#5 继续 + 14 条新做），其余 #31 cancelled、#58 done、#86 runtime。
