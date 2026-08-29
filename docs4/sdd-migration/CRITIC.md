# CRITIC — OpenWolf SDD 迁移第一片

自审 PLAN.md，5 处需修订，均已回填。

## 1. `phase` 与 `status` 各有一个 `complete`，语义重叠

PLAN.md 写 `phase: specify|plan|tasks|implement|complete`，`status` 又含 `complete`。两处 `complete` 指代不同（阶段完成 vs 工作终态），agent 容易写错。

**修订**：`phase` 只保留 `specify|plan|tasks|implement` 四值；`complete` 只存在于 `status` 且为终态。状态推进到 complete 时 `phase` 停在最后一值不动。

## 2. 模板落点含糊（`.wolf/specs/` 与顶层 `specs/` 撞名）

原写「技能通过 `.wolf/specs/` 引用模板」，但顶层 `specs/` 是用户 spec 产物，`.wolf/specs/` 又放模板，同名两义。

**修订**：模板播种到 `.wolf/spec-templates/`（`spec-template.md`/`plan-template.md`/`tasks-template.md`），技能读 `.wolf/spec-templates/*.md`；用户 spec 仍在顶层 `specs/###-name/`。

## 3. `openwolf spec set` 未校验 spec 存在

`set <id>` 若允许指向不存在的 spec，注入会指向空目录。

**修订**：`set` 校验 `specs/<id>/spec.md` 存在，否则报错并退出非零。可测。

## 4. 注入函数一个不够，读/写语义不同

pre-read 要「当前 spec + phase + 任务」摘要；pre-write 要「tests 阶段先写失败测试」的 TDD 提醒。两者不是同一个字符串。

**修订**：`inject.ts` 导出两个纯函数——`buildSpecContext(state, relPath)`（读）与 `buildTddReminder(state)`（写，仅 tasks/implement 阶段非空）。

## 5. 状态写者必须唯一，否则技能手写 JSON 会烂

技能是给 agent 的 markdown 指令，若让技能直接编辑 `.wolf/specs-state.json`，格式易碎。

**修订**：CLI `openwolf spec ...` 是 `.wolf/specs-state.json` 唯一写者（原子写）；技能只「写产物文件 + 调 CLI 推进状态」，不手改 JSON。

## 6. `nextTask` 全勾选时行为未定义

**修订**：`nextTask` 返回 `null` 表示无未完成任务，CLI 提示 `openwolf spec complete`。

---

其余不变。修订后的状态模型、文件计划、测试清单以 PLAN.md 为准。
