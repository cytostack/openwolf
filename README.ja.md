<p align="center">
  <img src="demo.gif" alt="OpenWolf demo" width="640" />
</p>

<h1 align="center">@alptech/openwolf</h1>

<p align="center">
  <strong>エージェントが変わっても、プロジェクトの記憶は引き継ぐ。</strong>
</p>

<p align="center">
  Claude Code、Codex、OpenCode で 1 つのプロジェクト記憶を共有し、<br />
  実際のセッション記録からトークン使用量を測定。完全ローカル、API 呼び出しなし。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@alptech/openwolf"><img src="https://img.shields.io/npm/v/@alptech/openwolf.svg" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">中文</a> ·
  <b>日本語</b> ·
  <a href="README.ru.md">Русский</a>
</p>

> **本リポジトリは [Cytostack](https://github.com/cytostack) による [openwolf](https://github.com/cytostack/openwolf) のフォークです。** 上流のビジネス機能を追跡しつつ、`@alptech/openwolf` としてのパッケージ識別子を維持します。

---

| OpenWolf なし | OpenWolf あり |
|---|---|
| すでに読んだファイルを再読込（約 2,000 tokens） | 一行の説明を先に読む、または読込自体をスキップ |
| 1 関数のためにファイル全体を読む | シンボル単位のヒントで正確な行範囲を `offset`/`limit` に渡せる |
| コンテキスト圧縮で作業内容が消える | PreCompact のスナップショットと復元で作業を保持 |
| エージェントごとに冷スタート | Codex / OpenCode / Claude Code / Cursor / Antigravity などで共有する `.wolf/` ブレイン |
| トークンの行き先が分からない | ハーネスのトランスクリプトから実測し、ローカル Dashboard で可視化 |

---

## なぜ OpenWolf か？

コーディングエージェントは強力ですが、盲目的に動きます。ファイルを開くまで内容が分からず、50 トークンの設定と 2,000 トークンのモジュールを区別できません。同じセッションで同じファイルを再読し、セッションをまたいで修正を忘れ、コンテキスト圧縮で何もかも失います。

OpenWolf は、永続的に共有されるプロジェクト記憶でこれらの問題を解決します：

- **コンテキスト管理。** 現在の目標・既知の失敗・修正済みバグ・プロジェクトマップなど、最も価値の高い状態をトークン予算付きでセッション開始時に注入。PreCompact と圧縮対応の再開により、圧縮後も作業が消えません。
- **アーキテクチャの足場。** 自己修復する永続インデックスが、各ファイルの説明・トークン見積もり、大きなファイルでは関数/クラスと行範囲を保持。エージェントはコードベースを再発見せずにナビゲートできます。
- **トークン活用。** 重複読込を検知し、全体読込を部分読込へ。ハーネスのトランスクリプトから実使用量を測り、見積もりではなく検証可能な節約を示します。

## クイックスタート

```bash
npm install -g @alptech/openwolf
cd your-project
openwolf init
```

`--agent` を省略すると、`init` は Claude Code と、マシン上で検出したその他のコーディングエージェントを接続します。`--agent` を指定した場合は、明示したエージェントだけを接続します。

## 対応エージェント

1 つの `.wolf/` ブレイン、複数エージェント：

| エージェント | 統合方式 | 深さ |
|--------------|----------|------|
| **Codex CLI** | `.codex/hooks.json` ライフサイクルフック + `AGENTS.md` | 完全（フック + コンテキスト） |
| **OpenCode** | ネイティブプラグイン + `AGENTS.md` | 完全（フック + コンテキスト） |
| **Claude Code** | 12 ライフサイクルフック + `CLAUDE.md` | 完全（フック + コンテキスト） |
| **Cursor** | `.cursor/rules/openwolf.mdc`（常時適用） | Beta（コンテキスト） |
| **Antigravity** | `AGENTS.md` プロトコルブロック | Beta（コンテキスト） |
| **Gemini CLI** | `GEMINI.md` プロトコルブロック | Beta（コンテキスト） |

```bash
openwolf init                          # Claude + その他のインストール済み Agent を自動検出（推奨）
openwolf init --agent claude           # Claude Code のみ
openwolf init --agent codex            # Codex のみ
openwolf init --agent opencode         # OpenCode のみ
openwolf init --agent gemini           # Gemini CLI のみ
openwolf init --agent cursor           # Cursor のみ
openwolf init --agent antigravity      # Antigravity のみ
openwolf init --agent codex opencode   # Codex と OpenCode のみ
openwolf init --agent all              # 対応するすべての Agent
```

明示した名前は厳密に適用されます。たとえば `--agent codex` では Claude、OpenCode、Gemini、Cursor、Antigravity の設定は作成されません。`init` を再実行しても、プロジェクトに既に存在する他の Agent のファイルは削除されません。

プロトコルブロックはマーカーで囲まれます。`AGENTS.md` や `GEMINI.md` の自作内容は触れず、`init` の再実行で重複もしません。

## 作成されるもの

`openwolf init` はプロジェクトに `.wolf/` を作成します：

| ファイル | 用途 |
|----------|------|
| `anatomy-index.json` | 永続プロジェクト索引：説明、トークン見積もり、コンテンツハッシュ、シンボル |
| `anatomy.md` | 索引の人間可読レンダリング（自動同期） |
| `cerebrum.md` | 学習メモリ：好み、訂正、Do-Not-Repeat |
| `memory.md` | 時系列の操作ログとトークン見積もり |
| `STATUS.md` | セッション引き継ぎ：短い読込で再開 |
| `buglog.json` | バグ修正メモリ（検索可能、再発見を防止） |
| `token-ledger.json` | 見積もりと実測のトークン使用量（セッション/エージェント別） |
| `hooks/` | 12 ライフサイクルフック（純粋な Node.js、依存ゼロ） |
| `config.json` | 設定（エージェント別コンテキスト予算を含む） |
| `OPENWOLF.md` | エージェントが従う運用プロトコル |

## 仕組み

```
セッション開始
    |
OpenWolf がトークン予算付きダイジェストを注入：現在の目標、既知の失敗、
最近のバグ修正、プロジェクトマップへのポインタ
    |
エージェントが大きなファイルを読もうとする
    |
OpenWolf: "auth.ts (~2,900 tok). Symbols: validateToken L82-140 ~450 tok.
offset/limit で必要な部分だけ読んでください。"
    |
エージェントがファイルを編集
    |
OpenWolf がクロスプロセスロック下で索引を更新し、操作を記録、コストを見積もる
    |
セッション中にコンテキストが圧縮される
    |
OpenWolf が圧縮前に状態をスナップショットし、既に変更したファイルの
ダイジェストを再注入。終わった作業のやり直しを防ぐ
    |
セッション終了
    |
OpenWolf がトランスクリプトから実トークン使用量を ledger に記録
```

## コンテキスト管理

- **セッションダイジェスト。** セッション開始時に最も価値の高い状態を、エージェントごとに設定可能なトークン予算内で注入。
- **圧縮サバイバル。** PreCompact が進行中状態をスナップショットし、圧縮後ダイジェストが変更済みファイルとアクションログへのポインタを示す。
- **鮮度検出。** スキャンは git HEAD をピン留め。HEAD が動いたりスキャンが古くなると、マップを信用する前に再スキャンするよう指示。
- **STATUS.md 引き継ぎ。** フェーズ終了状態を 1 つの小さな文書に集約し、新しいセッションは 1 回の読込で生産的な文脈に到達。

## プロジェクト Anatomy

索引は `anatomy-index.json` に永続化され、`anatomy.md` として可読表示されます。書き込みはクロスプロセスロックで調整。手書きや古いフック版による markdown 編集はコンテンツハッシュで検出し、加算的に吸収します。

見積もり 500 トークン超のファイルはトップレベルシンボルも索引化：

```
- `shared.ts` (~3,200 tok)
  - fn `parseAnatomy` L82-104 (~180 tok)
  - fn `serializeAnatomy` L106-129 (~200 tok)
```

大きなファイルを読む前に、最大のシンボルと行範囲を提示し、全体ではなく 1 関数を offset/limit で取得できるようにします。索引後にファイルが変わった場合、ヒントは自動抑制され、古い範囲で誤誘導しません。
シンボル対応言語：TypeScript、JavaScript、Python、Go、Rust。

## トークンインテリジェンス

見積もりは有用ですが、実測は信頼できます。セッション終了時に OpenWolf はハーネスのトランスクリプトから実使用量（input / output / cache read / cache write / API 呼び出し）を読み、実行したエージェントに帰属させます。

```bash
openwolf report
```

```
  Estimated (char-ratio heuristic)
    Total tokens:           1,549,658
    Est. savings vs bare:   1,772,690

  Measured (from harness transcripts)
    API calls:              29
    Input tokens:           57,489
    Cache reads:            309,141
```

1.x の実地結果（20 プロジェクト、132+ セッション）では平均 65.8% の見積もり削減、繰り返し読込の 71% を捕捉。2.x では自環境のワークロードで実測により節約を検証できます。

## セキュリティ

- Dashboard は 127.0.0.1 にバインドし、API/WebSocket はプロジェクトごとのトークン（タイミングセーフ比較）が必須
- 動的プロセス起動はすべて引数配列。シェル補間なし
- cron のファイルアクセスはパス・トラバーサル対策（realpath、シンボリックリンク安全）
- 秘密を含むファイル（keys、keystore、credential、`.npmrc`、`.env` など）は索引や memory に入れない
- `pnpm test` でセキュリティ回帰スイートを実行

## 同梱 Skills

`openwolf init` は設定済みエージェント（Claude Code、Codex、OpenCode）に 3 つのスラッシュコマンドを入れます：

- **`/handoff`**：Git、アクションログ、未完了項目から `STATUS.md` を再生成
- **`/security-audit [scope]`**：依存関係、秘密、インジェクション面、認可などの多層監査。重大度付きレポートを `.wolf/buglog.json` に連携
- **`/reframe [migrate | audit | fix]`**：デザイン脳。13 フレームワークの知識ベースで UI 選定/移行、または反ジェネリックなデザイン監査と修正

## Dashboard

```bash
openwolf daemon start
openwolf dashboard
```

ローカル・トークン認証のダッシュボード：見積もり vs 実測トークン、キャッシュ経済、エージェント別使用量、コンテキスト健全性、セッション引き継ぎ、ライブ活動、cron 制御、ファイル別シンボル付き anatomy ブラウザ。

## コマンド

```
openwolf init              .wolf/ を初期化し検出したエージェントを接続
openwolf status            健全性、統計、ファイル整合性
openwolf scan              プロジェクト索引を再構築
openwolf scan --check      索引がファイルシステムと一致するか検証（CI 向け）
openwolf report            トークンレポート：見積もり vs 実測
openwolf bench             OpenWolf 有効/無効の実コストと完了率を比較
openwolf map               重要度順のトークン予算付きプロジェクト概要
openwolf find <query>      anatomy 索引からファイルやシンボルを検索
openwolf dashboard         Web ダッシュボードを開く
openwolf daemon start      バックグラウンド daemon を開始
openwolf daemon stop       daemon を停止
openwolf cron list         スケジュール済みタスク
openwolf cron run <id>     タスクを手動実行
openwolf bug search <term> バグメモリを検索
openwolf update            登録済み全プロジェクトを更新（バックアップ付き）
openwolf restore [backup]  タイムスタンプ付きバックアップから .wolf/ をロールバック
```

インストール不要のスタンドアロン検査もあります：

```bash
node scripts/openwolf-check.mjs [projectDir]   # 読み取り専用の使用量レポート
```

## 要件

- Node.js 20+
- 対応コーディングエージェントが 1 つ以上
- Windows、macOS、または Linux
- 任意：永続バックグラウンド daemon 用の PM2

## 制限

- 見積もりは文字比率ヒューリスティック（おおよそ ±15%）。実測はハーネスのトランスクリプト由来で正確
- フック対応はエージェントにより異なる：Claude Code と Codex はフルライフサイクル、OpenCode はプラグインイベント、Gemini CLI と Cursor はコンテキスト中心
- プロトコル遵守（cerebrum 更新、バグ記録）はモデルが指示に従うかに依存。フックは強制できる部分を強制し、残りはリマインド
- 不具合は [Issue](https://github.com/nottyjay/openwolf/issues) へ

## 謝辞

本プロジェクトは [Cytostack](https://github.com/cytostack) / Farhan Palathinkal Afsal によるオリジナル
**[OpenWolf](https://github.com/cytostack/openwolf)** を基にしています。
上流の作者とコントリビューターのアーキテクチャ、フック、継続的な改善に感謝します。
本フォークは上流のビジネス機能を追跡し、`@alptech/openwolf` として公開します。

上流リポジトリ：https://github.com/cytostack/openwolf

## ライセンス

[AGPL-3.0](LICENSE)

## 作者

オリジナル：Farhan Palathinkal Afsal — [Cytostack](https://github.com/cytostack)。  
本フォークのメンテナ：`@alptech/openwolf` — [alptech](https://github.com/nottyjay) / [@nottyjay](https://github.com/nottyjay)。
