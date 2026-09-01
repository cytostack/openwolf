# OpenWolf

给 AI 编码 agent 的「第二大脑」。原来是 Claude Code 专属，现在给所有 AI 编码助手用。

**解决一件事：agent 看不见。** 它不知道一个文件里有什么、多大、是不是已经读过；它会在同一个 session 里反复读同一个文件；你纠正过它，下个 session 它就忘了；上下文一压缩，前面的活儿全丢。OpenWolf 在 agent 底下铺一层 `.wolf/` 记忆，把这些都接住——**不改你的工作流，7 个生命周期 hook 静默工作。**

---

## 快速开始

```bash
npm install -g openwolf

cd 你的项目
openwolf init
```

`init` 会自动检测机器上装了哪些 agent，把它们都接到同一个 `.wolf/` 记忆上。然后照常使用 agent，OpenWolf 在底下跑。

## 支持哪些 agent

一个 `.wolf/` 记忆，多个 agent 共享：

| Agent | 集成方式 | 深度 |
|-------|---------|------|
| Codex CLI | `.codex/hooks.json` + `AGENTS.md` | 完整（hook + 上下文） |
| OpenCode | 原生插件 + `AGENTS.md` | 完整 |
| Kilo | 原生插件 + `AGENTS.md` | 完整 |
| Claude Code | 7 个生命周期 hook + `CLAUDE.md` | 完整 |
| Cursor | `.cursor/rules/openwolf.mdc` | Beta（上下文） |
| Antigravity | `AGENTS.md` 协议块 | Beta（上下文） |
| Gemini CLI | `GEMINI.md` 协议块 | Beta（上下文） |

```bash
openwolf init                          # 自动检测（推荐）
openwolf init --agent codex opencode kilo   # 只接这几个
openwolf init --agent all              # 接所有检测到的
```

协议块是标记围栏的：你自己在 `AGENTS.md` 里的内容不会被碰，重复 init 也不会重复写入。

## 它解决什么

| 没有 OpenWolf | 有 OpenWolf |
|---|---|
| agent 反复读已经看过的文件（~2000 token） | 先读一行描述，或干脆跳过 |
| 为了找一个函数读整个文件 | 符号级提示给出精确行号，用 `offset/limit` 读一小段 |
| 上下文压缩把 session 干的事全抹了 | PreCompact 快照 + 恢复，活儿留在上下文里 |
| 每个 agent 从冷提示开始 | 一个共享 `.wolf/` 记忆，Codex/OpenCode/Kilo/Claude/Cursor/Antigravity 通用 |
| 不知道 token 花哪了 | 从 harness 转录里测真实用量，还有本地 dashboard |

## 核心机制

### 上下文管理

- **session 摘要**：每个 session 开始，把项目最有价值的状态（当前目标、已知错误、刚修的 bug、项目地图）按 token 预算注入。agent 不用读六个文件才进入状态。
- **压缩存活**：PreCompact 钩子在压缩前快照状态，压缩后重新注入"已经改过哪些文件"的摘要，agent 不会重做干完的活。
- **过期检测**：扫描钉住 git HEAD，HEAD 动了或扫描过期就提示 agent 重新扫描。错误的索引不会被静默信任。

### 项目解剖（anatomy）

一个持久的项目索引（`anatomy-index.json`），带可读视图（`anatomy.md`）。大文件（>500 token）连顶层符号都索引：

```
- shared.ts (~3,200 tok)
  - fn parseAnatomy L82-104 (~180 tok)
  - fn serializeAnatomy L106-129 (~200 tok)
```

agent 读大文件前，提示列出最大符号 + 行号，它就能只读一个函数。文件改了自动抑制提示——过期行号不会误导。

### Token 智能

估算有用，测量才可信。session 结束，OpenWolf 从 harness 转录里读真实用量：输入/输出 token、缓存读/写、API 调用，按 agent 归属。

```bash
openwolf report
```

1.x 实测（20 项目、132+ session）平均估算省 65.8% token，71% 的重复读被拦住。那些是估算；2.0 让你自己的数字变成测量的，不是模型拍的。

### Hippocampus 记忆系统

**情节记忆**：记下项目里发生了什么、什么时候、在哪。文件写/改/读都存成事件，带上下文和结果。

- **valence（事件性质）**：
  - **penalty**：用户明确纠正（user-prompt 钩子）或测试失败（post-test 钩子）。
  - **trauma**：高强度负面事件，读取时再次浮现，永不衰减。
  - **neutral**：普通文件操作。
  - 「编辑 ≥3 次 = trauma」的旧启发式已退役——它只产生假阳性（一个 dogfood 周期 51 个），现在 valence 只来自显式信号。

- **复发（recurrence）**：`recordRecurrence()` 记"修形状编辑命中同路径的历史 penalty"。注意一个机制事实：测试失败的 penalty 带 `files_involved: []`（没有路径），所以**只有用户纠正（带路径）能触发复发**。

```bash
openwolf recall /path/to/file.ts          # 查一个文件的全部事件
openwolf recall --match-mode prefix /path/to/src/   # 目录前缀匹配
openwolf recall --type state --error "TypeError" /path/to/src/
openwolf recall --json /path/to/file.ts
```

## Benchmark

一条命令跑三个维度，写报告：

```bash
pnpm benchmark            # 覆盖率 + 性能 + 结果
pnpm benchmark --coverage # 加行覆盖率
```

- **Coverage**：`benchmarks/seams.json` 里每个公开 seam 的「功能 × 测试」矩阵，附未测函数清单。
- **Performance**：热路径的 ops/sec + p50/p95 延迟。
- **Outcome**：token 节省 + `recurrence_rate`，负写入为 0 时显式标「数据不足」。

还有一个 dogfood harness，驱动真实 hook 走「犯错 → 修 → 再犯」闭环，断言第一次非零 `recurrence_rate`（实测 0.667）：

```bash
node scripts/dogfood-recurrence.mjs              # 隔离临时项目
node scripts/dogfood-recurrence.mjs --rounds 5   # 更多再犯循环
```

## 命令

```
openwolf init              初始化 .wolf/ 并接线检测到的 agent
openwolf status            健康、统计、文件完整性
openwolf scan              重建项目索引
openwolf scan --check      校验索引与文件系统一致（CI 友好）
openwolf recall <path>     从 hippocampus 记忆召回事件
openwolf claim             管理当前知识声明
openwolf spec              Spec 驱动开发（SDD）状态
openwolf report            Token 报告：估算 vs 实测
openwolf doctor            健康检查：漂移 + hook 完整性
openwolf dashboard         打开 Web dashboard
openwolf daemon start      启动后台 daemon
openwolf daemon stop       停止 daemon
openwolf cron list         定时任务
openwolf cron run <id>     手动触发任务
openwolf bug search <词>   搜索 bug 记忆
openwolf update            更新所有注册项目（带备份）
openwolf restore [备份]    从时间戳备份回滚 .wolf/
```

## 安全

- Dashboard 只绑 127.0.0.1，所有 API/WebSocket 访问都要 per-project token（timing-safe 比较）。
- 所有动态进程调用走参数数组，无 shell 插值。
- cron 文件访问有 realpath 的路径穿越防护。
- 密钥文件（key、keystore、credential、`.npmrc`、`.env` 等）绝不进索引或记忆。
- 安全回归套件随 `pnpm test` 跑。

## 要求与限制

- Node.js 20+
- 至少一个受支持的编码 agent
- Windows / macOS / Linux
- 可选：PM2（持久 daemon）

限制：

- 估算用字符比启发式（约 15% 误差）；测量来自 harness 转录，是精确的。
- hook 覆盖因 agent 而异：Claude Code 和 Codex 有完整生命周期，OpenCode/Kilo 用插件事件，Gemini/Cursor 只有上下文。
- 协议遵守（更新 cerebrum、记 bug）依赖模型照做；hook 强制能强制的，其余靠提醒。

## License

[AGPL-3.0](LICENSE)
