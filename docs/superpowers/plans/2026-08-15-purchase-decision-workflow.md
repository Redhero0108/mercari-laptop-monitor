# 購入判断ワークフロー 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** 既存の静的結果ページに、上限付きの価格/いいね履歴・信頼度を考慮したランキング・シリーズ/閲覧状態フィルター・展開可能な詳細・おすすめの説明・24時間の変化マーカーを追加する。

**アーキテクチャ:** 新しい純粋な `result-history.mjs` モジュールが上限付きの観測履歴を管理する。`monitor.mjs` はリクエストや間隔を変えずに既存の結果レコードを拡充する。`results-page.mjs` は信頼度・トレンド・ランキングを導出し、自己完結型のHTMLインターフェースを描画する。個人の閲覧状態は `localStorage` に残る。

**テックスタック:** Node.js ES modules、組み込み `node:assert/strict`、静的HTML/CSS/JavaScript、PowerShell起動スクリプト、最終ブラウザ検証用 Playwright CLI。

## グローバル制約

- バックエンドとページ更新は10分ごとのまま。ポーリング・ブラウザページ・Mercariリクエストを追加しない。
- サードパーティ依存・データベース・常駐プロセスを追加しない。
- 商品ごとの価格・いいねの観測値は最大12個の異なる値まで。
- 個人の閲覧状態はブラウザの `localStorage` のみに保持。
- 現在の落ち着いたベージュ・金茶・緑のインターフェースを維持。

---

### Task 1: 上限付きの結果履歴

**Files:**
- Create: `result-history.mjs`
- Create: `test-result-history.mjs`
- Modify: `monitor.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `mergeResultHistory(previous, current, observedAt, baseline)` が `current` に `firstSeenAt`・`priceHistory`・`likeHistory` を加えて返す。
- Consumes: 利用可能な場合 `state.seen[item.id]` からの `baseline = { firstSeenAt, price }`。

- [ ] **Step 1: 失敗する履歴テストを書く**

```js
assert.deepEqual(
  mergeResultHistory(null, { price: 70000, likeCount: 2 }, '2026-08-15T00:00:00Z', {}),
  {
    price: 70000,
    likeCount: 2,
    firstSeenAt: '2026-08-15T00:00:00Z',
    priceHistory: [{ value: 70000, at: '2026-08-15T00:00:00Z' }],
    likeHistory: [{ value: 2, at: '2026-08-15T00:00:00Z' }],
  },
);
```

また、同一値は追加しないこと、変化した値は追加すること、レガシーのベースライン価格が保持されること、無効な値は無視されること、13回の変化で最新12件のみ保持されることを検証する。

- [ ] **Step 2: テストを実行して RED を確認**

Run: `node test-result-history.mjs`

Expected: `result-history.mjs` が存在しないため失敗。

- [ ] **Step 3: 最小の履歴マージを実装**

既存の配列を有限な `{ value, at }` エントリへ正規化し、レガシー値をシードし、最後の異なる値が変わったときのみ追加し、`-12` にスライスする。

- [ ] **Step 4: 履歴テストを実行して GREEN を確認**

Run: `node test-result-history.mjs`

Expected: `result history tests: OK`。

- [ ] **Step 5: モニター書き込みを統合**

`monitor.mjs` で `mergeResultHistory` をインポート。まず各現在の結果オブジェクトを作り、次に代入：

```js
results[item.id] = mergeResultHistory(previous, current, now, {
  firstSeenAt: state.seen[item.id]?.seenAt,
  price: state.seen[item.id]?.price,
});
```

`recordResult` と `recordLiveResult` で同じパスを使う。`npm test` / `npm run check` に `test-result-history.mjs` と `result-history.mjs` を追加。

- [ ] **Step 6: Task 1 を検証**

Run: `npm test && npm run check`

Expected: すべてのスイートと構文チェックが成功。

### Task 2: 信頼度・トレンド・変化・1つのランキングルール

**Files:**
- Modify: `results-page.mjs`
- Modify: `test-results-page.mjs`
- Modify: `monitor.mjs`

**Interfaces:**
- Produces: `storageSpecConflict(entry)`、`specConfidence(entry)`、`priceTrend(entry)`、`recentChangeBadges(entry, nowMs)`、`compareRecommendedEntries(left, right)`。
- Changes: `isDisplayQualified` と `primaryBlocker` がメモリ/ストレージ矛盾を警告として扱う。モニター出力と最有力候補は `compareRecommendedEntries` を使う。

- [ ] **Step 1: 失敗する導出テストを書く**

リテラルフィクスチャで検証：

```js
assert.deepEqual(
  storageSpecConflict({ title: '32GB SSD512GB', reasons: ['1TB存储'] }),
  { conflict: true, label: 'タイトル512GB / 検出1TB・要確認' },
);
assert.equal(specConfidence(confirmedTitle).label, 'タイトル確認');
assert.equal(priceTrend(changedPrice).delta, -5000);
assert.deepEqual(recentChangeBadges(changedEntry, nowMs).map((x) => x.label), ['新着', '値下げ', 'いいね +2']);
```

異なるアラート・スコア・価格を持つ3つのリテラルエントリを使ってランキング順を検証する。

- [ ] **Step 2: テストを実行して RED を確認**

Run: `node test-results-page.mjs`

Expected: 新しいエクスポート済みヘルパーが無いため失敗。

- [ ] **Step 3: 純粋ヘルパーと安全動作を実装**

NFKC正規化後に明示的なタイトルのメモリ/ストレージ値を検出。ネットワーク呼び出しなしで信頼度を導出。直近2つの異なる履歴ポイントを計算し、最新ポイントが24時間以内の場合のみ変化バッジを出す。設計どおりの正確なコンパレータを実装。

- [ ] **Step 4: テストを実行して GREEN を確認**

Run: `node test-results-page.mjs`

Expected: `results page tests: OK`。

- [ ] **Step 5: モニター出力でコンパレータを使う**

`renderResultsPage` の隣で `compareRecommendedEntries` をインポートし、古いアラート/時刻ソートを置き換え、`bestEntry` にも同じコンパレータを使う。

- [ ] **Step 6: Task 2 を検証**

Run: `npm test && npm run check`

Expected: すべてのスイートと構文チェックが成功。

### Task 3: 判断ワークフローインターフェース

**Files:**
- Modify: `results-page.mjs`
- Modify: `test-results-page.mjs`

**Interfaces:**
- Extends: `matchesResultRow(dataset, filter, query, options)` が `series` と `triage` 条件を扱う。
- Produces: 描画コントロール `#series-filter`・`#triage-filter`・`.detail-toggle`・`.product-details`・`.triage-button`・`.change-badge`・`.recommendation-help`。

- [ ] **Step 1: 失敗するフィルター・描画テストを書く**

検索・クイックフィルター・シリーズ・閲覧状態の組み合わせの実挙動を検証：

```js
assert.equal(matchesResultRow(
  { match: '1', changed: '1', grade: '3', search: 'elitebook', series: 'hp-elitebook', triage: 'watch' },
  'changed',
  'EliteBook',
  { series: 'hp-elitebook', triage: 'watch' },
), true);
```

履歴とシリーズフィールドを含むフィクスチャを描画。コントロール・展開詳細コンテンツ・24時間バッジ・トレンドテキスト・おすすめ説明・`aria-expanded`・`aria-pressed`・エスケープされた動的テキスト・reduced-motion CSS・有効なインラインJavaScriptを検証。

- [ ] **Step 2: テストを実行して RED を確認**

Run: `node test-results-page.mjs`

Expected: 最初の欠落セレクタまたは変化フィルターのアサーションが失敗。

- [ ] **Step 3: コンパクトなコントロールと行コンテンツを実装**

現在のエントリから一意なシリーズオプションを生成。`24H 新上架` クイックフィルターを `24H 有变化` に置換。価格トレンドと変化バッジを追加。DOMソートを安定に保つため詳細は商品セル内に維持。

- [ ] **Step 4: ローカルの閲覧状態と詳細操作を実装**

キーを使う：

```js
const triageStorageKey = 'mercari-laptop-monitor-triage-v1';
const seriesStorageKey = 'mercari-laptop-monitor-series';
const triageFilterStorageKey = 'mercari-laptop-monitor-triage-filter';
```

新しい行の既定は `unseen`。商品を開くと `unseen` のみ `seen` へ変更。閲覧状態ボタンは `unseen`・`watch`・`ignored` を設定。既定の `active` フィルターは無視行を除外。状態変更のたびに可視性を再実行し、検索/並び/フィルター状態を保持。

- [ ] **Step 5: 控えめなCSSとアクセシブルなモーションを適用**

ラッパーのコントロールバー1本・静かなテキストバッジ・内側の詳細領域・可視フォーカス・160msトランジションを追加。追加：

```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
```

- [ ] **Step 6: 対象・完全テストを実行**

Run: `node test-results-page.mjs && npm test && npm run check`

Expected: すべてのスイートと構文チェックが成功。

### Task 4: ライブ生成とブラウザ受入

**Files:**
- Generated, not committed: `results.html`, `results.json`
- Modify only if a failing acceptance check exposes a tested defect: related source and test file.

**Interfaces:**
- Consumes: 既存の `stop-background.ps1`、`start-background.ps1`、`open-results.cmd` ワークフロー。
- Produces: 単一の既存モニタープロセスが生成する1つのライブ静的ページ。

- [ ] **Step 1: 既存モニターを1回再起動**

既存の停止・開始スクリプトを実行し、`monitor.pid` が1つの応答するNodeプロセスを指し、`results.html` に新しいタイムスタンプがあることを確認。

- [ ] **Step 2: ブラウザ受入**

ワークスペースをテストセッションの間だけ提供。Playwrightで検証：

- シリーズフィルターが結果を絞る。
- 詳細が開き `aria-expanded` を更新する。
- ignored に設定すると `active` で行が隠れ、`ignored` で再表示される。
- 状態が再読み込み後も保持される。
- おすすめ説明と変化マーカーが描画される。
- 1440px で7列が揃い、820px レイアウトも使用可能。

- [ ] **Step 3: すべての一時検証リソースを停止**

Playwrightブラウザを閉じ、一時HTTPサーバーを停止。意図したモニターNodeプロセスのみ残す。

- [ ] **Step 4: 最終検証とコミット**

Run: `git diff --check && npm test && npm run check`

`git status` を確認し、計画されたソース/テスト/docs のみステージし、コミットし、クリーンなワークツリーと最新コミットを確認。
