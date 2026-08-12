<p align="center">
  <img src="demo.gif" alt="OpenWolf demo" width="640" />
</p>

<h1 align="center">@alptech/openwolf</h1>

<p align="center">
  <strong>Claude Code 的第二大脑。现已支持主流 AI 编程助手。</strong>
</p>

<p align="center">
  更优的上下文管理、架构索引与 Token 利用，<br />
  通过 7 个不可见生命周期 Hook 自动生效，零工作流改动。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@alptech/openwolf"><img src="https://img.shields.io/npm/v/@alptech/openwolf.svg" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>中文</b> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ru.md">Русский</a>
</p>

> **本仓库是 [openwolf](https://github.com/cytostack/openwolf)（[Cytostack](https://github.com/cytostack)）的 fork。** 同步上游业务能力，并保留 `@alptech/openwolf` 包名与项目身份。

---

| 没有 OpenWolf | 有 OpenWolf |
|---|---|
| Agent 重复读取已看过的文件（约 2,000 tokens） | 先读一行描述，或直接跳过读取 |
| 为找一个函数读完整文件 | 符号级提示给出精确行号，支持 `offset`/`limit` |
| 上下文压缩会丢掉本轮工作 | PreCompact 快照与恢复，压缩后仍可续作 |
| 每个 Agent 都从冷启动开始 | 共享同一套 `.wolf/` 大脑（Codex / OpenCode / Claude Code / Cursor / Antigravity 等） |
| 不知道 Token 花在哪里 | 从 harness 转录读取实测用量，并提供本地 Dashboard |

---

## 为什么需要 OpenWolf？

编程 Agent 很强，但默认是“盲操作”：不知道文件内容与体量，会在同一次会话里重复读文件，跨会话忘记你的纠正，上下文压缩后又像失忆。

OpenWolf 提供第二大脑：

- **上下文管理**：会话开始注入预算受限的高价值摘要；PreCompact + 压缩后重启，避免工作进度被抹掉。
- **架构脚手架**：可自愈的项目索引，含描述、Token 估算，大文件还有函数/类与行号范围。
- **Token 利用**：拦截重复读取，整文件读变切片读，并从 harness 转录测量真实用量。

## 快速开始

```bash
npm install -g @alptech/openwolf
cd your-project
openwolf init
```

`init` 会自动检测本机已安装的编程 Agent，并接入同一套 `.wolf/` 大脑。之后照常使用 Agent 即可。

## 支持的 Agent

| Agent | 集成方式 | 深度 |
|-------|----------|------|
| **Codex CLI** | `.codex/hooks.json` 生命周期 Hook + `AGENTS.md` | 完整（Hook + 上下文） |
| **OpenCode** | 原生插件 + `AGENTS.md` | 完整（Hook + 上下文） |
| **Claude Code** | 7 个生命周期 Hook + `CLAUDE.md` | 完整（Hook + 上下文） |
| **Cursor** | `.cursor/rules/openwolf.mdc`（始终应用） | Beta（上下文） |
| **Antigravity** | `AGENTS.md` 协议块 | Beta（上下文） |
| **Gemini CLI** | `GEMINI.md` 协议块 | Beta（上下文） |

```bash
openwolf init                          # 自动检测已安装 Agent（推荐）
openwolf init --agent codex opencode   # 只接入指定 Agent
openwolf init --agent all              # 接入全部可检测 Agent
openwolf init --agent claude           # 仅 Claude Code
```

协议块使用 marker 围栏：不会改动你自己写在 `AGENTS.md` / `GEMINI.md` 中的内容，重复执行 `init` 也不会重复插入。

## 会创建什么

`openwolf init` 会在项目中创建 `.wolf/`：

| 文件 | 作用 |
|------|------|
| `anatomy-index.json` | 持久化项目索引：描述、Token 估算、内容哈希、符号 |
| `anatomy.md` | 索引的可读渲染，自动保持同步 |
| `cerebrum.md` | 学习记忆：偏好、纠正、Do-Not-Repeat |
| `memory.md` | 按时间顺序的操作日志与 Token 估算 |
| `STATUS.md` | 会话交接：少量阅读即可恢复进度 |
| `buglog.json` | Bug 修复记忆，可搜索，避免重复踩坑 |
| `token-ledger.json` | 估算与实测 Token 用量（按会话/Agent） |
| `hooks/` | 7 个生命周期 Hook（纯 Node.js，零依赖） |
| `config.json` | 配置，含各 Agent 上下文预算 |
| `OPENWOLF.md` | Agent 需遵循的操作协议 |

## 工作原理

```
会话开始
    |
OpenWolf 注入受 Token 预算限制的摘要：当前目标、已知错误、近期修复、项目地图指针
    |
Agent 准备读取大文件
    |
OpenWolf: "auth.ts (~2,900 tok)。符号: validateToken L82-140 ~450 tok。
可用 offset/limit 只读需要的部分。"
    |
Agent 编辑文件
    |
OpenWolf 在跨进程锁下更新索引、记录动作、估算成本
    |
会话中发生上下文压缩
    |
OpenWolf 在压缩前快照，压缩后重新注入已修改文件摘要，避免重复劳动
    |
会话结束
    |
OpenWolf 从转录中读取真实 Token 用量写入 ledger
```

## 上下文管理

- **会话摘要**：在可配置的每 Agent Token 预算内注入最高价值状态。
- **压缩存活**：PreCompact 快照 + 压缩后摘要，续作不再从零开始。
- **过期检测**：扫描会钉住 git HEAD；HEAD 变动或扫描过期时会提示重扫。
- **STATUS.md 交接**：阶段结束状态集中在一个小文件，新会话一次读取即可恢复。

## 项目 Anatomy

索引以 `anatomy-index.json` 持久化，并以 `anatomy.md` 可读呈现。写操作通过跨进程锁协调；对手写或旧版 Hook 修改的 markdown，会按内容哈希做增量吸收。

估算超过 500 tokens 的文件还会索引顶层符号：

```
- `shared.ts` (~3,200 tok)
  - fn `parseAnatomy` L82-104 (~180 tok)
  - fn `serializeAnatomy` L106-129 (~200 tok)
```

当前支持符号提取的语言：TypeScript、JavaScript、Python、Go、Rust。

## Token 智能

估算有用，测量更可信。会话结束时 OpenWolf 从 harness 转录读取真实用量：input / output / cache read / cache write / API 调用次数，并归属到对应 Agent。

```bash
openwolf report
```

1.x 实战数据（20 个项目、132+ 会话）平均估算节省约 65.8% Token，71% 的重复读被拦截。2.x 起可用实测数据在你自己的工作负载上验证。

## 安全

- Dashboard 仅绑定 `127.0.0.1`，API/WebSocket 使用每项目 token（时序安全比较）
- 动态进程调用一律参数数组，无 shell 拼接
- Cron 文件访问有路径穿越防护（realpath，符号链接安全）
- 密钥类文件（keys、keystore、credential、`.npmrc`、`.env` 等）不进入索引与 memory
- `pnpm test` 包含安全回归套件

## 内置 Skills

`openwolf init` 会为已配置 Agent（Claude Code、Codex、OpenCode）安装：

- **`/security-audit [scope]`**：依赖、密钥、注入面、鉴权等分层审计，结果写入 `.wolf/buglog.json`
- **`/reframe [migrate | audit | fix]`**：UI 框架选型/迁移与反“AI 味”设计审计（含 13 个框架知识库）

## Dashboard

```bash
openwolf daemon start
openwolf dashboard
```

本地、需 token 认证的控制台：估算 vs 实测 Token、缓存经济、按 Agent 用量、上下文健康、会话交接、实时活动、cron 控制、带符号的 anatomy 浏览器。

## 命令

```
openwolf init              初始化 .wolf/ 并接入检测到的 Agent
openwolf status            健康状态、统计、文件完整性
openwolf scan              重建项目索引
openwolf scan --check      校验索引是否与文件系统一致（适合 CI）
openwolf report            Token 报告：估算 vs 实测
openwolf dashboard         打开 Web Dashboard
openwolf daemon start      启动后台 daemon
openwolf daemon stop       停止 daemon
openwolf cron list         查看定时任务
openwolf cron run <id>     手动触发任务
openwolf bug search <term> 搜索 bug 记忆
openwolf update            更新所有已注册项目（带备份）
openwolf restore [backup]  从时间戳备份回滚 .wolf/
```

也可使用无需安装的只读检查脚本：

```bash
node scripts/openwolf-check.mjs [projectDir]
```

## 环境要求

- Node.js 20+
- 至少一个受支持的编程 Agent
- Windows / macOS / Linux
- 可选：PM2（持久化后台 daemon）

## 局限

- 估算基于字符比启发式（大约 ±15%）；实测来自 harness 转录，更精确
- 不同 Agent 的 Hook 覆盖不同：Claude Code / Codex 完整，OpenCode 走插件事件，Gemini / Cursor 主要为上下文级
- cerebrum / buglog 的协议遵从仍依赖模型执行指令；Hook 负责可强制的部分
- 发现问题请提交：[Issues](https://github.com/nottyjay/openwolf/issues)

## 致谢

本项目基于 **[OpenWolf](https://github.com/cytostack/openwolf)** 原项目，作者为
[Cytostack](https://github.com/cytostack) / Farhan Palathinkal Afsal。
感谢上游作者与贡献者提供的架构、Hook 体系与持续改进。本 fork 同步上游业务功能，并以 `@alptech/openwolf` 发布。

上游仓库：https://github.com/cytostack/openwolf

## 许可证

[AGPL-3.0](LICENSE)

## 作者

原项目作者：Farhan Palathinkal Afsal — [Cytostack](https://github.com/cytostack)。  
本 fork 维护方：`@alptech/openwolf` — [alptech](https://github.com/nottyjay) / [@nottyjay](https://github.com/nottyjay)。
