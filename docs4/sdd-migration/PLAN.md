# OpenWolf SDD 层 — 迁移 spec-kit 思想（第一片）

> 目标：把 `spec-kit-for-kilocode` 的「spec → plan → tasks → implement + TDD 门禁 + 记忆当前 spec」思想，落到 OpenWolf 自己的接缝上，让 OpenWolf 具备「设定 spec、让 agent 跟着 spec 走、记住 spec、按 TDD 执行」的能力。
> 范围裁决（已与用户确认）：**状态化完整骨架**，但**长期任务复用 `.wolf/STATUS.md`**，不引入独立 goal 状态机。

---

## 结论先行

**能做，第一片做「状态机 + 注入 + 技能 + 模板 + CLI」五件套，全部 TDD。** 新增一个 `src/specs/` 纯模块承载状态机与注入字符串（唯一的新运行时逻辑），其余是 markdown 技能/模板 + 三处接线。代价：两个 tsconfig 各多一行 include，测试需要 `pnpm build` 先跑。

## 不是做什么（边界）

- **不是**照搬 spec-kit 的 Kilo 原生工具调用（`update_todo_list`、`new_task`、memory-bank 命令）——OpenWolf 没有这些，用 skill + `.wolf/` 状态替代。
- **不是**引入 goal-persistence 的 idle 自启动循环 / budget 机器——「长期任务」沿用 STATUS.md 的 Next phase，spec 状态只是指针。
- **不是**给 Kilo 插件做第二套 spec 逻辑——Kilo 插件本阶段只读同一个 `.wolf/specs-state.json` 注入一句话，不复制状态机。

## 迁移映射

| spec-kit | OpenWolf 落地 | 证据锚点 |
|---|---|---|
| `/specify` `/plan` `/tasks` | 三个 skill | `src/agents/skills.ts:13` `SKILLS` + `src/templates/skills/` |
| `@spec-implementer` | `/implement` skill + TDD 纪律 | 同上 |
| `memory-bank/` | `.wolf/STATUS.md`（活跃 feature）+ `cerebrum.md` | `src/templates/STATUS.md` |
| `specs/` 目录 | 顶层 `specs/###-name/`（用户产物） | 新增约定 |
| memory 记忆 spec | `.wolf/specs-state.json`（活跃 spec/当前任务/阶段/状态） | 新增 `src/specs/` |
| TDD 阶段门（测试先失败） | `tasks.md` 门禁 + `/implement` + pre-write 提醒 | 新增模板/技能/钩子 |

## 文件级计划

### 1. `src/specs/`（唯一运行时模块，全部 TDD）

| 文件 | 职责 | 测试 |
|---|---|---|
| `types.ts` | `SpecState`、`SpecPhase`、`SpecStatus` 类型 | 类型仅编译 |
| `phase-machine.ts` | `advancePhase(state, target)`、`setStatus(state, status)`——只允许合法转移，非法抛错 | `tests/specs-phase-machine.test.ts` |
| `tasks-parse.ts` | `nextTask(tasksMd)`——解析 `- [ ] T###`，返回第一个未勾选；`isPhaseGateMet` 之类 | `tests/specs-tasks-parse.test.ts` |
| `inject.ts` | `buildSpecContext(state, relPath)`（读：spec/phase/任务摘要）+ `buildTddReminder(state)`（写：tasks/implement 阶段提醒测试先行）——两个纯函数 | `tests/specs-inject.test.ts` |
| `spec-store.ts` | `loadSpecState`/`saveSpecState`——原子写 `.wolf/specs-state.json`，损坏则备份 | `tests/specs-store.test.ts` |
| `index.ts` | 汇总导出 | — |

**状态模型**（复用 goal-persistence 的 Active→Paused/Blocked/Complete，去掉 usage/budget；`complete` 只出现在 `status`，避免与 `phase` 撞名）：

- `phase: specify | plan | tasks | implement`，合法前进序 `specify→plan→tasks→implement`；允许 `implement→tasks`（重排任务）。阶段推进到 complete 时 `phase` 停在最后一值不动。
- `status: active | paused | blocked | complete`；`complete` 终态。`active→paused/blocked/complete`，`paused/blocked→active`，其余拒绝。
- `currentTask: string | null`（implement 阶段为 `T###`）。
- `activeSpec: string | null`。

### 2. 技能（markdown，无运行时逻辑）

`src/templates/skills/` 新增 4 个，并加入 `src/agents/skills.ts:13` 的 `SKILLS`：

- `specify.md` — 读 `spec-template.md`，算下一个编号，写 `specs/###-name/spec.md`，更新 `.wolf/specs-state.json`（phase=specify, status=active），更新 STATUS.md 活跃 feature。
- `plan.md` — 读 spec，写 `plan.md`/`research.md`/`data-model.md`/`contracts/`/`quickstart.md`，phase→plan。
- `tasks.md` — 读 plan+data-model，写 `tasks.md`（T001–T499 + TDD 门禁 + 依赖图），phase→tasks。
- `implement.md` — 读 tasks.md，逐条 TDD（红→绿→重构），勾选后 `openwolf spec next` 推进，phase→implement。

### 3. 模板（markdown）

`src/templates/specs/` 新增 3 个（`spec-template.md`、`plan-template.md`、`tasks-template.md`），init 时播种到 `.wolf/spec-templates/`。`/specify` 等 skill 读 `.wolf/spec-templates/*.md`。内容精简自 spec-kit，去掉 Kilo 原生工具，保留 TDD 门禁与 [NEEDS CLARIFICATION] 标注。用户 spec 产物仍在顶层 `specs/###-name/`。

### 4. 接线

| 改动 | 文件 | 验证 |
|---|---|---|
| `installSkills` 加 4 技能 | `src/agents/skills.ts:13` | `tests/kilo-adapter.test.ts` 加断言 |
| 模板播种进 `.wolf/specs/` | `src/cli/init.ts`（写模板循环） | `pnpm build` + smoke |
| 钩子注入当前 spec | `src/hooks/pre-read.ts`（~L137 后加） | 单元测 `buildSpecContext` |
| 钩子注入 TDD 提醒 | `src/hooks/pre-write.ts`（tasks/implement 阶段） | 单元测 `buildTddReminder` |
| Kilo 插件注入 | `src/templates/kilo-plugin/pre-read.ts` | 只读 `specs-state.json` 一句话 |
| `tsconfig.hooks.json` include 加 `src/specs/**` | `tsconfig.hooks.json:14` | `pnpm build:hooks` 通过 |

### 5. CLI

`src/cli/spec-cmd.ts` + 注册进 `src/cli/index.ts`：

```
openwolf spec status           # 打印活跃 spec / phase / 当前任务
openwolf spec set <id>         # 激活 spec（校验 specs/<id>/spec.md 存在）
openwolf spec next             # 推进 currentTask（读 tasks.md 下一个未勾选；全勾选则提示 complete）
openwolf spec phase <p>        # 前进阶段（校验合法转移）
openwolf spec pause|resume|block|complete
```

CLI 是 `.wolf/specs-state.json` 的**唯一写者**（原子写）；技能只「写产物文件 + 调 CLI 推进状态」，不手改 JSON。

---

## TDD 测试清单（红→绿）

| 测试文件 | 断言核心 |
|---|---|
| `tests/specs-phase-machine.test.ts` | 合法前进通过、跳过阶段抛错、非法 status 抛错、complete 终态 |
| `tests/specs-tasks-parse.test.ts` | 解析未勾选任务、勾选后跳过、`[P]` 标注保留、边界（无任务/全勾选） |
| `tests/specs-inject.test.ts` | 注入串含 spec id/phase/currentTask；无活跃 spec 返回空 |
| `tests/specs-store.test.ts` | 原子写往返、损坏备份、缺失返回默认 |

> 预期值一律用手工例子/字面量，不复用实现算法重算（Do-Not-Repeat 2026-08-29）。

## 验收标准

1. `pnpm build` 通过（两个 tsconfig 都过）。
2. `pnpm test` 新增测试全绿，旧测试不回归。
3. `openwolf init` 后：`.wolf/specs-state.json` 存在、`/specify /plan /tasks /implement` 技能装入 `.kilo/command/`（及 `.claude/commands/`）。
4. 手工 smoke：`openwolf spec set 001-x` → `spec status` 显示 → 读 spec 相关文件触发 pre-read 注入。

## 风险与对策

- **风险**：`src/specs` 进 `tsconfig.hooks.json` 后，钩子独立构建可能因相对 import 路径漂移报错。**对策**：先加 include 跑 `pnpm build:hooks` 验证再写逻辑。
- **风险**：Kilo 插件 pre-read 与原生 hooks pre-read 语义分叉（已有先例）。**对策**：Kilo 插件只加「读 state + 一句话」，不复制状态机。
- **风险**：`nextTask` 解析 tasks.md 的勾选格式对 markdown 变化脆弱。**对策**：正则严格匹配 `^\s*-\s*\[ \]\s*(T\d+)`，测边界。

---

*待办锚点：`src/hooks/pre-read.ts:137`（注入点）、`src/hooks/pre-write.ts:42`（TDD 提醒点）、`src/agents/skills.ts:13`（SKILLS）、`tsconfig.hooks.json:14`（include）。*
