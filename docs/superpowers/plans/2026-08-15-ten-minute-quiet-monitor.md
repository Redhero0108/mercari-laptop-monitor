# 10分の静かな監視 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** `open-results.cmd` が隠しモニターと結果ページを起動し、すべてのMercariチェックとページ再読み込みを10分間隔で実行するようにし、高頻度の状態ポーリングやハートビート書き込みを行わないようにする。

**アーキテクチャ:** 既存の冪等な隠しPowerShellランチャーと静的HTML結果ページを維持する。共有ランタイム設定を10分に変更し、600秒のページ再読み込みを描画し、モニター状態をページ読み込みごとに1回だけ読み込み、モニターの単独ハートビートタイマーを削除して、スケジュールチェックの合間はプロセスをアイドルにする。

**テックスタック:** Node.js ES modules、静的HTML/CSS/JavaScript、Windows PowerShell 5.1、CMD、Node組み込みテストアサーション。

## グローバル制約

- WindowsとPowerShellがサポート対象のランタイムのまま。
- 新規依存なし、商品フィルター・通知ルール・保存結果形式への変更なし。
- 検索・ライブ商品更新・ページ再読み込みの間隔はすべて正確に10分。
- `open-results.cmd` は単一のダブルクリック入口のままで、モニターを重複作成しない。
- ページは10秒の状態ポーリングを行わず、モニターは待機中にハートビートファイルを書き込まない。

---

### Task 1: 失敗テストで10分挙動を固定

**Files:**
- Create: `test-runtime-intervals.mjs`
- Modify: `test-results-page.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `renderResultsPage(entries, config, options)`（`results-page.mjs` から）。
- Produces: ページ再読み込みマークアップ・状態ポーリング削除・ランタイム設定・ハートビートタイマー削除の回帰カバレッジ。

- [ ] **Step 1: 失敗するページ描画アサーションを書く**

`rendered` 作成後にアサーションを追加：

```js
assert.match(rendered, /<meta http-equiv="refresh" content="600">/);
assert.match(rendered, /10分ごとに自動更新/);
assert.match(rendered, /refreshMonitorStatus\(\);/);
assert.doesNotMatch(rendered, /setInterval\(refreshMonitorStatus/);
```

- [ ] **Step 2: ランタイム間隔の回帰テストを作成**

`config.json` と `monitor.mjs` を読み、`pollMinutes === 10`・`likesRefreshMinutes === 10` を検証し、モニターの既定値とフォールバックが10であることを確認し、`startHeartbeat` 内の `setInterval` を拒否する `test-runtime-intervals.mjs` を作成する。

- [ ] **Step 3: 対象テストを登録して失敗を確認**

`test` スクリプトに `node test-runtime-intervals.mjs` を追加し、次を実行：

```powershell
node .\test-results-page.mjs
node .\test-runtime-intervals.mjs
```

Expected: 少なくとも600秒のページ再読み込みアサーションと `pollMinutes === 10` のアサーションが既存実装に対して失敗する。

### Task 2: 静かな10分スケジューリングを実装

**Files:**
- Modify: `config.json`
- Modify: `monitor.mjs`
- Modify: `results-page.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: 既存の `config.pollMinutes`、`config.likesRefreshMinutes`、`setMonitorPhase()`、ページレンダラー。
- Produces: 10分の検索/ライブ更新スケジューリングと、10分ごとに再読み込み・状態読み込みを行うページ。

- [ ] **Step 1: ランタイム間隔を更新**

`config.json` の `pollMinutes` を `10` に設定。`monitor.mjs` で `pollMinutes` の既定値と無効値フォールバックを `5` から `10` に変更しつつ、既存の最小値バリデーションは維持。

- [ ] **Step 2: モニターのハートビートタイマーを削除**

`heartbeatTimer`・`startHeartbeat()`・その呼び出しを削除。状態書き込みは `setMonitorPhase()` に残し、`stopHeartbeat()` は停止状態のみ書き込むようにして、シャットダウン動作の互換性を維持。

- [ ] **Step 3: 生成ページを更新**

meta refresh を `600` に変更し、ヒントにページとバックエンドの両方が10分ごとに更新されると記載し、状態切れしきい値を15分に変更し、`refreshMonitorStatus()` の呼び出しは1回のまま、`setInterval` 呼び出しは削除。

- [ ] **Step 4: 運用ドキュメントを更新**

README の5分の検索/ページ更新記述を10分に変更し、状態ファイルがページ読み込みごとに1回だけ読まれること、隠しプロセスがチェック間はアイドルであることを記載。

- [ ] **Step 5: 対象テストを実行してコミット**

Run:

```powershell
node .\test-results-page.mjs
node .\test-runtime-intervals.mjs
node .\test-powershell.mjs
```

Expected: 3コマンドすべてがそれぞれの `OK` を表示し exit 0。

実装とテストをまとめて、message `feat: 十分钟静默刷新监控` でコミット。

### Task 3: 生成物を検証して隠しモニターを再起動

**Files:**
- Runtime-only: `results.html`, `monitor.pid`, `monitor-status.js`, `monitor.log`

**Interfaces:**
- Consumes: `stop-background.ps1`、`start-background.ps1`、更新済みレンダラー。
- Produces: 新しい10分設定を使う1つの実行中モニターと、新しく生成された結果ページ。

- [ ] **Step 1: 完全な検証スイートを実行**

```powershell
npm test
npm run check
```

Expected: すべてのテストが成功し、記載されたJavaScriptファイルがすべて構文チェックを通過。

- [ ] **Step 2: プロジェクトのモニターのみ再起動**

`stop-background.ps1` を実行し、このプロジェクトが記録した PID が動作していないことを確認してから `start-background.ps1` を実行。無関係なNode/PowerShellプロセスは停止しない。

- [ ] **Step 3: ランタイム出力を検証**

初期ページ生成だけを待ち、`results.html` に `content="600"` が含まれ、`setInterval(refreshMonitorStatus` が含まれず、`monitor-status.js` が1つのアクティブ PID を記録していることを検証。`monitor.log` が10分の検索・ライブデータ更新間隔を報告していることを確認。

- [ ] **Step 4: リポジトリ範囲を確認**

`git status --short` と `git diff --check` を実行。意図したソース・テスト・README・計画ファイルのみ変更され、ランタイム生成物は無視されたままであること。
