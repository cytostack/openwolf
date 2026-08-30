# 轨迹匹配（Trajectory Matching）设计

> 状态：设计稿 v1（已自批）。实现前先读 §4 风险。
> 结论：当前 recall 是「单事件 cue 匹配 + 按位置翻旧创伤」，不是轨迹匹配。最小可行版 = 把事件压成签名、按 session 排成序列、用当前后缀匹配历史序列、预测「下一步会不会坏」，坏了提前预警。

## 1. 现状（代码锚点）

- `cue-recall.ts` `scoreEvent(event, cue, request)`：单事件打分，cue 只有 location/question/state，无顺序维度。
- `cue-index.ts`：`location_index` / `question_index` / `state_index`，按事件倒排，不是按序列。
- `pre-read.ts:111`：`getTraumas(relativeFile)` + `match_mode:"parent"`——按位置翻旧创伤。
- 创伤被特权化：不衰减、按 `intensity` 排。

**数据里已有轨迹原料，但全是死的：**

- `turn_in_session` 硬编码 `0`（`post-write.ts:275`、`user-prompt.ts:55`、`post-test.ts:79`）——事件没有真实「第几步」。
- 顺序只能靠 `timestamp` 重建。
- `spatial_path` / `spatial_depth` / `session_id` 有值；`recent_errors` 在 post-test 里有写（`post-test.ts:81`）。
- `is_recurring` / `first_event_id` 字段在（复发概念），但 `post-write.ts:289` 仍是 `is_recurring: editCount >= 3` 旧启发式——**待确认**：编辑次数启发式在 valence 上退役了，这个 recurrence flag 疑似漏网。
- 「recent valence sequence detection」在 `docs2/PLAN.md` Phase 2.4 就计划过、被推迟（`docs2/critic/5_CRITIC_PLAN.md:16` 也点了名）。

## 2. 轨迹匹配是什么（概念 → 实现）

真实海马体：位置细胞按顺序放电，大脑把「当前部分轨迹」和「存储的历史轨迹」匹配，预测接下来发生什么。

翻译成 OpenWolf：

- **事件签名** = `action.type + ":" + outcome.valence`（如 `edit:neutral`、`edit:penalty`）。v1 不拼位置，先要顺序维度。
- **轨迹** = 一个 session 内按时间排好的一串签名（如 `[edit:neutral, edit:neutral, edit:penalty, fix:neutral]`）。
- **匹配** = 拿当前 session 最近 k 个签名（后缀），去历史序列里找「出现过同样后缀」的片段。
- **输出** = 那些历史片段「下一步」是什么。若历史上这个模式后面跟着 penalty/trauma，提前预警：「你现在的动作模式，历史上多次通向 bug」。

关键差别一句话：**现在 recall 是回头看单个事件；轨迹匹配是看一串动作、预测下一步。** 现在的「创伤记忆」是轨迹匹配的退化情形——单事件、按位置查。

## 3. 最小实现边界（v1）

**做（4 个纯函数 + 1 处接线）：**

1. `eventSignature(event) → string`：`action.type + ":" + outcome.valence`。
2. `buildTrajectoryIndex(events)`：按 `session_id` 分组、按 `timestamp` 排序，产出每个 session 的签名序列。
3. `matchTrajectory(recentSignatures, index, k)`：找历史序列里与当前后缀（k 个签名）相同的片段，返回「该片段之后下一个签名」的分布。
4. 接线 `post-write`（轨迹随写入更新，不是 pre-read）：当前后缀的历史「下一步」里 penalty/trauma 占比 ≥ 0.5 且历史样本 ≥ 3 次 → 打一句预警。

**不做（明确排除，防 scope 膨胀）：**

- 不修 `turn_in_session`（v1 用 timestamp 排，够用；真 turn 号是独立待办）。
- 不做跨 session 全局轨迹（先 session 内）。
- 不做「位置 + 动作」联合签名（先 `action:valence`，稀疏了再迭代）。
- 不塞进现有 `recall` 接口——这是**预测**不是**召回**，独立成 `matchTrajectory` 路径，避免污染召回语义。

## 4. 风险与自批（已并入上面的边界）

- **冷启动**：没历史序列就没预测（和 recurrence_rate 0/0 同病）。v1 诚实输出「无匹配」，不硬造。
- **精确后缀匹配太苛刻**：k 取大了几乎永不匹配 → 永远冷启动。v1 用 **k=2~3 的小后缀**；模糊匹配（编辑距离/部分匹配）留给 v2。
- **签名粒度**：`edit:neutral` 这种粗签名会误报（所有中性编辑都一样）。v1 靠「历史样本 ≥3 + 阈值 0.5」压误报，再迭代。
- **timestamp 排序脆弱**：`turn_in_session` 是 0，跨毫秒重排可能错序。v1 接受，把「修 turn_in_session」记为待办。
- **复发 flag 待确认**：`post-write.ts:289` 的 `is_recurring: editCount >= 3` 可能是漏网的旧启发式，实现前先核对该不该一并退役。

## 5. 实现步骤（TDD）

1. red：`eventSignature` + `buildTrajectoryIndex`（给定事件序列 → 正确签名序列）。
2. red：`matchTrajectory`（历史有 `edit:neutral→edit:penalty` 后缀，当前同后缀 → 预测 penalty 占优）。
3. green：实现三个函数。
4. 红检：改坏 `eventSignature`（如把 valence 写死），测试必须变红。
5. 接线 `post-write`，用真实 `src/**` 文件 + 预置历史序列测预警输出。
6. 重跑 `pnpm benchmark`，确认覆盖新增了轨迹维度。
