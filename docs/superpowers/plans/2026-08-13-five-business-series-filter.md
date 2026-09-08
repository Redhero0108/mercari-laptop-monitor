# 5つのビジネスシリーズフィルター 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** MercariのノートPC監視と表示結果を、ThinkPad X1 Carbon・HP ProBook・Dell Precision・Panasonic Let's note・Dynabook G83 に制限しつつ、現在のハードウェア・CPU・状態・価格・在庫・JUNK除外を維持する。

**アーキテクチャ:** ノートシリーズとハードフィルターに特化したモジュールを追加し、5つのサポートシリーズを正規化して拒否理由を説明する。スコアリングとすべての監視取り込み/更新パスでそれを再利用し、各結果に適合性の事実を保存し、ページ再生成時にレガシー結果をフィルターする。既存のグローバルCLIを唯一のキーワード書き込みパスとし、5つの容量検索を、シリーズ＋32GB の5つの検索へ原子的に置き換える。

**テックスタック:** Node.js ES modules、組み込み `node:assert`、PowerShell、グローバル `mercari-watch` CLI。

## グローバル制約

- ランタイムは Windows 10 と PowerShell 互換のまま。
- 許可シリーズは正確に ThinkPad X1 Carbon・HP ProBook・Dell Precision・Panasonic Let's note・Dynabook G83。
- 32GBメモリ・512GB以上のSSD・Intel第12世代以上・状態レベル1-3・価格上限・JUNK除外・在庫チェックを維持。
- 商品を購入せず、出品者にも連絡しない。
- ユーザーが別途要求しない限りコミットしない。

---

### Task 1: シリーズ認識とハード適合性

**Files:**
- Create: `laptop-filters.mjs`
- Create: `test-laptop-filters.mjs`
- Modify: `scoring.mjs`
- Modify: `test-scoring.mjs`

**Interfaces:**
- Produces: `DEFAULT_ALLOWED_SERIES`、`detectLaptopSeries(text)`、`isAllowedLaptopSeries(text, allowedSeries)`、`hardFilterFailure(assessment)`、`resultMatchesHardFilters(entry, allowedSeries)`。
- Produces: モニター永続化のための `assessment.series`・`assessment.seriesEligible`・既存のハードウェア情報。

- [ ] **Step 1: 5つのシリーズ・拒否される非対象シリーズ・ハードウェア欠落の失敗テストを書く**

5つのサポートファミリーすべてにリテラルタイトルを使い、HP EliteBook をネガティブ例として使う。それ以外は適合する EliteBook が、`allowedSeries` 設定時に通知対象にならないことを検証する。

- [ ] **Step 2: 対象テストを実行し、新しいモジュールとフィールドが存在しないため失敗することを確認**

Run: `node test-laptop-filters.mjs`

- [ ] **Step 3: 最小の正規化器を実装し、スコアリングへ接続**

安定したシリーズIDとラベルを返し、日本語 `レッツノート` と一般的な `CF-*` 型番表記をサポートし、`allowedSeries` が存在しない場合のみスコアリングを無制限に保つ。

- [ ] **Step 4: 対象のスコアリング/フィルターテストを実行し、通過を確認**

Run: `node test-laptop-filters.mjs; node test-scoring.mjs`

### Task 2: モニター全体でルールを強制

**Files:**
- Modify: `monitor.mjs`
- Modify: `config.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 のフィルター関数と評価フィールド。
- Produces: 初期スキャン・メタデータ更新・ライブ更新・レガシー結果のページ再生成で厳格なフィルター。

- [ ] **Step 1: 永続化されたレガシー・現在の結果形状に対するモニター向けアサーションを `test-laptop-filters.mjs` に追加**

- [ ] **Step 2: 対象テストを実行し、レガシー結果ケースが失敗することを確認**

Run: `node test-laptop-filters.mjs`

- [ ] **Step 3: すべての取り込みパスのCPU・状態チェックの後にハードフィルターを適用**

`has32GB`・`has512GB`・`hasSSD`・`seriesId`・`seriesLabel`・`seriesEligible` を永続化し、同じフィルターで結果を再生成して古い非対象行を消す。

- [ ] **Step 4: `allowedSeries` を5つの安定IDに設定し、制限を文書化**

- [ ] **Step 5: 対象テストと構文チェックを実行**

Run: `npm run check; node test-laptop-filters.mjs; node test-scoring.mjs`

### Task 3: `mercari-watch` を通じて5つの監視タスクを置換

**Files:**
- Modify through CLI: `config.json`（`queries` のみ）

**Interfaces:**
- Consumes: `mercari-watch keywords replace-all`。
- Produces: 各許可シリーズ名＋`32GB` を使う5つの有効タスク。

- [ ] **Step 1: 5つのシリーズ検索で原子的置換をドライラン**

`X1 Carbon 32GB`・`HP ProBook 32GB`・`Dell Precision 32GB`・`レッツノート 32GB`・`dynabook G83 32GB` を使う。短い X1 クエリは、多くの正当なMercariタイトルが `ThinkPad` の語を省略するため必須。

- [ ] **Step 2: 同じ置換を `--yes` で適用**

- [ ] **Step 3: 安定したJSON出力でタスクと設定を確認**

Run: `mercari-watch --json tasks list; mercari-watch --json config show`

- [ ] **Step 4: 完全なオフラインテストスイートを実行し、最終diffを確認**

Run: `npm test; npm run check; git diff --check; git status --short`
