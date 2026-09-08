# 品質優先ビジネスシリーズ 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** 品質でフィルターされた6つのビジネスノートシリーズを追加し、通知上限を ¥70,000 に引き下げ、旧シリーズ許可リストだけによってスキップされた出品を安全に再チェックする。

**アーキテクチャ:** 中央のシリーズ検出器を正確な製品ラインルールで拡張し、すべての許可リスト利用者がその安定IDを使うようにする。純粋な状態マイグレーションヘルパーを追加して、新たに許可されたシリーズ拒否だけを復元し、スキャンの前に呼び出す。独立した ¥99,999 の結果上限は変更せず、すべての通知価格の既定を ¥70,000 に揃える。

**テックスタック:** Node.js ES modules、JSON設定、Windows PowerShell起動スクリプト、Node組み込みアサーション。

## グローバル制約

- 元の5つの許可シリーズを維持。
- LIFEBOOK U7412・高品質VersaPro・ExpertBook B9・VAIO Pro・Latitude 5000/7000/9000・EliteBook のみ追加。
- 汎称VersaPro・Latitude 3000・汎称VAIO・非U7412 LIFEBOOK・非B9 ExpertBook は除外のまま。
- 通知上限は正確に `70000`。結果上限は正確に `99999` のまま。
- 旧シリーズルールで拒否され、新しい検出器で許可される履歴エントリのみ復元。
- 依存を追加せず、CPU・メモリ・ストレージ・状態・通知・10分スケジューリングのルールを変更しない。

---

### Task 1: 正確なシリーズ認識を追加

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`
- Modify: `test-scoring.mjs`
- Modify: `scoring.mjs`

**Interfaces:**
- Consumes: `detectLaptopSeries(text)` と `DEFAULT_ALLOWED_SERIES`。
- Produces: 6つの安定ID: `fujitsu-lifebook-u7412`、`nec-versapro-premium`、`asus-expertbook-b9`、`vaio-pro`、`dell-latitude-premium`、`hp-elitebook`。

- [ ] **Step 1: 失敗する肯定的・否定的な検出器テストを書く**

6つのIDに対する肯定的タイトルと、`LIFEBOOK U9312`・汎称 `NEC VersaPro`・`ExpertBook B5`・`VAIO SX12`・`Latitude 3420` に対する否定的アサーションを追加。`UltraLite` または `タイプVN` を含む肯定的VersaProタイトルと、Latitude 5350・7450・9450 を含める。

- [ ] **Step 2: 検出器テストを実行して RED を確認**

Run `node .\test-laptop-filters.mjs`。

Expected: 最初の新しい肯定的ケースに検出IDがない。

- [ ] **Step 3: 最小の正規表現ルールを追加**

`SERIES_RULES` の汎用コンシューマーの前にルールを追加：

```js
{ id: 'fujitsu-lifebook-u7412', label: 'Fujitsu LIFEBOOK U7412', pattern: /\blife\s*book\s*u7412\b/i }
{ id: 'nec-versapro-premium', label: 'NEC VersaPro Premium Mobile', pattern: /^(?=.*\bversapro\b)(?=.*(?:ultra\s*lite|タイプ\s*v(?:n|g|h|m)\b))/i }
{ id: 'asus-expertbook-b9', label: 'ASUS ExpertBook B9', pattern: /\bexpert\s*book\s*b9(?:\d{3})?\b/i }
{ id: 'vaio-pro', label: 'VAIO Pro', pattern: /\bvaio\s*pro\b/i }
{ id: 'dell-latitude-premium', label: 'Dell Latitude 5000/7000/9000', pattern: /\blatitude\s*(?:5|7|9)\d{3}\b/i }
{ id: 'hp-elitebook', label: 'HP EliteBook', pattern: /(?:\bhp\s+)?\belite\s*book\b/i }
```

- [ ] **Step 4: スコアリングの対象範囲とビジネスモデル認識を拡張**

6つのIDをスコアリングテストの許可リストへ追加し、受け入れられるすべてのタイトルが ¥60,000 で通知できることを確認し、`BUSINESS_MODELS` に `expertbook\s*b9` と受け入れられるVersaPro形式を追加する。

- [ ] **Step 5: 対象テストを実行して GREEN を確認**

Run `node .\test-laptop-filters.mjs` と `node .\test-scoring.mjs`。

Expected: 両方とも `OK` を表示し exit 0。

### Task 2: 新たに許可された過去スキップのみを移行

**Files:**
- Create: `state-migrations.mjs`
- Create: `test-state-migrations.mjs`
- Modify: `monitor.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `isAllowedLaptopSeries(title, allowedSeries)`。
- Produces: `restoreNewlyAllowedSeriesSkips(state, allowedSeries) -> string[]`。`state.seen` のみを変異させ、復元したアイテムIDを返す。

- [ ] **Step 1: 失敗する移行テストを書く**

旧シリーズ拒否（現在許可）・旧シリーズ拒否（まだ不許可）・ストレージ拒否・正常な既視アイテムを含む状態フィクスチャを作る。新たに許可されたシリーズIDのみが削除・返されることを検証する。

- [ ] **Step 2: 移行テストを実行して RED を確認**

Run `node .\test-state-migrations.mjs`。

Expected: `state-migrations.mjs` の module-not-found。

- [ ] **Step 3: 純粋な移行ヘルパーを実装**

過去のメッセージ `不在指定五个商务系列中` と `非指定商务系列` を認識する。各一致エントリについて、現在のタイトルが許可されている場合のみ削除する。`initialized` や無関係なエントリには触れず、削除したIDを返す。

- [ ] **Step 4: モニタースキャンの前に移行を統合**

ヘルパーを `monitor.mjs` にインポート。ログが利用可能になった後、PID取得とページ生成の前に呼び出す。IDが返されたら `saveState()` を一度呼び、`已恢复 N 件因旧系列规则跳过的商品，等待重新检查。` をログ出力。ライブハードフィルターメッセージを `不在指定品质商务系列中` に変更。

- [ ] **Step 5: テストを登録して実行**

`npm test` に `node test-state-migrations.mjs`、`npm run check` に `node --check state-migrations.mjs` を追加し、`state-migrations.mjs` と `monitor.mjs` の両方で対象テストと構文チェックを実行。

Expected: 移行テストが `OK` を表示。構文チェック exit 0。

### Task 3: 通知上限のみ引き下げ

**Files:**
- Modify: `config.json`
- Modify: `monitor.mjs`
- Modify: `scoring.mjs`
- Modify: `results-page.mjs`
- Modify: `test-scoring.mjs`
- Modify: `test-results-page.mjs`
- Modify: `test-runtime-intervals.mjs`

**Interfaces:**
- Consumes: 通知判定の `config.maxPriceYen` と結果保持の `config.maxResultPriceYen`。
- Produces: 通知しきい値 `70000`、変更しない結果保持しきい値 `99999`。

- [ ] **Step 1: 価格境界の失敗テストを書く**

完全適合の ¥70,000 アイテムが通知し、¥70,001 アイテムが通知しないこと、`primaryBlocker()` が `超预算 ¥1` を報告すること、ランタイム設定が `maxPriceYen === 70000` かつ `maxResultPriceYen === 99999` であることを検証する。

- [ ] **Step 2: 価格テストを実行して RED を確認**

Run `node .\test-scoring.mjs`、`node .\test-results-page.mjs`、`node .\test-runtime-intervals.mjs`。

Expected: 少なくとも ¥70,001 の通知または設定アサーションが、旧 ¥95,000 しきい値の下で失敗する。

- [ ] **Step 3: 設定値とフォールバックの通知上限を揃える**

`config.json.maxPriceYen`・`monitor.mjs` の既定・`scoring.mjs` のフォールバック・`results-page.mjs` のフォールバックを `70000` に設定。すべての `maxResultPriceYen` は `99999` のまま。

- [ ] **Step 4: 対象テストを実行して GREEN を確認**

3つの価格関連テストファイルを再度実行。

Expected: すべて `OK` を表示し exit 0。

### Task 4: 文書化・検証・コミット・有効化

**Files:**
- Modify: `README.md`
- Runtime-only: `state.json`, `results.json`, `results.html`, `monitor.pid`, `monitor-status.js`, `monitor.log`

**Interfaces:**
- Consumes: プロジェクトのテストスクリプトとプロジェクト固有のバックグラウンド開始/停止スクリプト。
- Produces: コミット済み実装と、新しいフィルターを使う実行中10分モニター1つ。

- [ ] **Step 1: README を更新**

厳格な Latitude・VersaPro の限定を含めて11の許可シリーズすべてを列挙し、¥70,000 通知と ¥99,999 結果上限を文書化し、「five series」や ¥95,000 への参照を削除。

- [ ] **Step 2: 完全な検証を実行**

Run `npm test`、`npm run check`、`git diff --check`、CLI の `doctor` と `config show`。

Expected: すべてのテストと構文チェックが成功。doctor が `ready: true` を報告。設定が `70000`・`99999`・11の許可IDすべてを報告。

- [ ] **Step 3: 実装をコミット**

ソース・テスト・設定・README を `feat: 扩展品质商务本筛选` でコミット。

- [ ] **Step 4: 無関係なプロセスに触れず有効化**

`monitor.pid` と `stop-background.ps1` を使ってプロジェクトのモニターのみ停止。上限付きの `mercari-watch --json check` を開始して対象の移行を適用し復元アイテムを再チェックしてから、`start-background.ps1` を再起動。

- [ ] **Step 5: ランタイム出力を検証**

ログが復元件数を報告し、新しい隠しモニターが `実行中 / 次のチェックを待機中` に達し、生成結果に ¥100,000 以上のアイテムが残らず、不許可の否定的シリーズフィクスチャが検出器を通過できないことを確認。

- [ ] **Step 6: 最終リポジトリ状態を確認**

完了報告の前に `git status --short`、`git log -4 --oneline`、新規の `npm test` と `npm run check` を実行。
