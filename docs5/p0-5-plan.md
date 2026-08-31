# P0-5 实施计划：事件 turn 序号（修 `turn_in_session` 硬编码 0）

> source-anchored-design 产物，v2（已按 critic 修订，blocking 清零）。锚点以 HEAD `c2f2bba` 为准，已用 Read 核实行号。

## 结论

**事件需要"第几步"序号，让 trajectory 排序不依赖 timestamp（同毫秒会错序）。做法 = 在 `addEventToStore`（已在 `withHippocampusLock` 内）按同 `session_id` 扫 buffer 取 `max(turn)+1` 盖章，钩子仍可传 `turn_in_session: 0`；同时 `buildTrajectoryIndex` 和 `post-write.ts` 的查询后缀都改为"turn>0 按 turn、否则 timestamp"的一致排序。**

关键修正（vs v1）：① 历史侧（`buildTrajectoryIndex`）和查询侧（`post-write.ts:301-304` 的 `sessionSignatures`）**必须同步改**，否则只改一半、同毫秒错序在查询侧照旧；② 性能回退的真实论据是"满 buffer 每次扫 500 + fsync 主导"，不是 v1 错写的"O(N²) 人为放大"。

## 目标（是什么 / 不是什么）

- **是什么**：每个事件写入时获得 1-based、同 session 单调递增的 `turn_in_session`，跨 session 各自从 1 计；trajectory 的历史序列和查询后缀用**同一排序规则**。
- **不是什么**：不是"让钩子传真实 turn"（并发钩子撞号）；不是引入 `_session.json` 计数（读写竞争）；不是改 schema 版本（P0-1）。

## 现状锚点（已核实）

- `src/hooks/post-write.ts:276` / `user-prompt.ts:55` / `post-test.ts:79`：`turn_in_session: 0` 硬编码。
- `src/hooks/post-write.ts:301-304`：`sessionSignatures` 按 `timestamp` 排（`.sort((a,b)=>new Date(a.timestamp)...)`）——**这是 v1 漏掉的查询侧**。
- `src/hippocampus/trajectory.ts:20-33 buildTrajectoryIndex`：现在只按 `timestamp` 排（`list.sort(...)` 在 `:23-25`），`sessionOrder` 不存在。
- `src/hippocampus/event-store.ts:71 addEventToStore`：原样 `store.buffer.push(event)`（`:72`），不盖章；evict 在 `:103-110`。
- `src/hippocampus/index.ts:426-441 addEvent`：`loadStoreOrCreate → addEventToStore → saveStore` 全程在 `withHippocampusLock` 内。
- `event-store.ts:12 max_buffer_size: 500`。

## 方案对比

### 方案 A：`addEventToStore` 内扫 buffer 取 max+1 盖章

```ts
export function nextTurnInSession(store, sessionId) {
  let max = 0;
  for (const e of store.buffer)
    if (e.session_id === sessionId && Number.isInteger(e.context.turn_in_session) && e.context.turn_in_session > max)
      max = e.context.turn_in_session;
  return max + 1;
}
export function addEventToStore(store, event) {
  event.context.turn_in_session = nextTurnInSession(store, event.session_id);
  store.buffer.push(event); // 其余不变
}
```

- **优点**：无新状态字段；store 唯一事实源，序号与 buffer 天然一致；盖章在 `addEvent` 锁内，并发安全。
- **缺点（精确版，纠正 v1 的错误分析）**：
  - **性能**：`nextTurnInSession` 每次扫 buffer。benchmark 的 `addEventToStore`（`performance.ts` 同一 `createEmptyStore`（500）连续 add）稳态是 **O(500) 常数**，不是 v1 错写的 O(N²)——因为 evict（`event-store.ts:103-110`）把 buffer 硬限在 500。实测 5.2 倍回退（278 万→54 万 ops/sec）= "满 buffer 时每次写多扫 500 次整数比较"，这是**生产长 session 的常态，不是人工构造**。接受理由是 `saveStore` 的 fsync ~16ms（`index.ts:437/491` 的注释）完全淹没微秒级扫描，不是"人为放大"。
  - **evict 不回退 max（v1 误判）**：evict 移除 `buffer.findIndex(non-trauma)`（`:105`）= 最早插入的非 trauma 事件，turn 最小，**不影响任何 session 的 max**。真正的"从 1 重计"只发生在某 session 事件被全部驱逐——那是合理的"session 重开"语义。
  - **consolidation 回退 max（真实边界）**：`consolidation` 把高 consolidation_score 的事件移到 neocortex（`consolidation.ts runConsolidation`），被移走的可能含该 session 的高 turn 事件；`nextTurnInSession` 只扫 buffer 不扫 neocortex，同 session 新事件 turn 会重复。这是 A 的**真实正确性边界**，不是"低频可忽略"——但影响面是"跨 consolidation 续写的 session"，非活跃期。

### 方案 B：`store.stats` 持久化 per-session 水位（O(1)）

`stats` 加 `turn_watermark: Record<string, number>`，盖章读水位 +1 并回写。

- **优点**：O(1)；水位持久化，驱逐/consolidation 不回退（解掉 A 的唯一真实边界）。
- **缺点**：新增状态字段 + 旧 store backfill（load 时扫 buffer 初始化水位）+ 水位与 buffer 漂移需 reconcile + 复杂度上升。

### 方案 C：修钩子传真实 turn —— 不采纳（并发撞号，`_session.json` 读写竞争）。

## 推荐 + 依据（A vs B 是唯一待拍板的点）

**倾向 A，但这是设计取舍，需用户拍板。**

- 选 A 的理由：A 在 P0-5 的**直接目标**（当前 session 活跃期的 trajectory 排序正确）上完全正确；consolidation 回退只影响"跨 consolidation 续写"的次要场景，且 consolidation 是 daemon 定期长时转移，活跃 session 的事件不在其首轮 promote 范围。
- 选 B 的理由（critic 主张）：B 一步解掉 consolidation 回退这个唯一真实边界，且 O(1)；代价是新状态 + backfill + reconcile，但若后续做 P0-13（跨 session 轨迹）这些状态本来就要有。
- **待拍板**：A（简，牺牲跨 consolidation 续写的正确性）还是 B（对，引入状态复杂度）。

## 成功标准（test + benchmark）

- **红**：① 同 session 全 0 事件盖章后 `[1,2,3]`；② 跨 session 各自从 1；③ 2 进程各写 5 条同 session，turns 排序 = `1..10` 无撞号；④ `buildTrajectoryIndex` 与 `post-write` 查询后缀在 turn>0 时按 turn 排、全 0 回退 timestamp；⑤ 契约测试：`addEventToStore` 无条件盖章（传 `turn=99` 也被覆盖成 `max+1`）。
- **绿**：实现后全过，全套 169 → 174（+5 断言）。
- **benchmark**：记录 `addEventToStore` 新数字（预期 ~54 万 ops/sec），作为"接受 O(500) 扫描"的量化凭证，写进附录。
- **mutation**：故意把 `nextTurnInSession` 改 `return max`（不 +1），断言测试变红；改回。

## 风险与边界（显式记录）

1. **O(500) 扫描**：接受，理由 = fsync 主导（见上）。
2. **evict 不回退**：已澄清（v1 误判），无需处理。
3. **consolidation 回退**：真实边界，A 方案接受之；触发条件 = 同 session 事件被 consolidation 移走后继续写。若真实 dogfood 发现此场景错序，升级 B。
4. **契约变化（定死，不留 P0-1）**：`addEventToStore` 无条件盖章、覆盖调用方 turn，是**显式不变量**，用测试锁定。当前唯一"传真实 turn"的调用方是 benchmark 的 `makeEvent`（`performance.ts:73` 传 `turn_in_session: i`），盖章后它被覆盖——benchmark 只测性能不测语义，可接受，但要意识到改完后全代码库只有盖章这一处产生真实 turn。
5. **混合 turn 语义**：存量 store 旧事件 turn=0 永久保留（不迁移），新事件盖 1..n；同 session 混有 0 与 >0 时 `buildTrajectoryIndex` 的"两边>0 才按 turn"回退 timestamp——这是迁移窗口的**降级行为**（旧事件被 evict 后自然消失），可接受，明确记录。
6. **纯函数无锁**：`addEventToStore` 是纯函数，生产路径被 `withHippocampusLock` 串行化（`index.ts:426-441/480-495`）；唯一无锁调用方是单线程 benchmark。盖章 mutate 入参且不幂等（同一 event 二次调用会 re-stamp + 重复 push），但生产路径每次构造新 event，无此问题。措辞：不是"幂等安全"，是"纯函数 + 生产路径锁内串行化"。

## 已核实结论（v1 的"待挑战"项）

- **盖章不破坏现有测试**：已核实——全仓库无一处断言依赖具体 `turn_in_session` 值（`eventData()`/`makeEvent()`/`writerScript*` 硬编码 1 或 i+1，但断言只查 id/stage/buffer 长度；`trajectory.test.ts` 的 turn 恒 0）。盖章安全，无需为此改测试。
