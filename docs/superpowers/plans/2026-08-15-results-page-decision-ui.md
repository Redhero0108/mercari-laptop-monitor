# 結果ページの判断UI 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** 結果ページを、よりコンパクトで信頼でき、購入価値をすばやく判断できる操作画面へ作り変え、承認済みの8つのフロント改善を完全に実装する。

**アーキテクチャ:** `results-page.mjs` のサーバー側文字列生成方式を維持しつつ、単体テスト可能なスペック矛盾・時刻フォーマットの純関数を追加し、同じファイル内のHTML・CSS・軽量スクリプトを再構成する。すべてのフィルターはブラウザローカルで完結し、依存・リクエスト・バックグラウンドタイマーを追加しない。

**テックスタック:** Node.js ESM、ネイティブHTML/CSS/JavaScript、`node:assert/strict`

## グローバル制約

- ページの meta refresh 600秒とバックグラウンドの10分チェックを維持。
- 常時ポーリング・タイマー・アニメーションライブラリ・サードパーティ依存は追加しない。
- スペック矛盾はフロントの「通知条件合致」表示にのみ影響し、バックグラウンドの監視データは変更しない。
- ページの通知予算は `config.maxPriceYen` を読み、既定値は ¥70,000。
- ユーザーが持つローカル検索・フィルター・並び順の記憶を維持。

---

### Task 1: 判断とフィルターのデータモデル

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Produces: `memorySpecConflict(entry): { conflict: boolean, label: string }`
- Produces: `isDisplayQualified(entry): boolean`
- Extends: `matchesResultRow(dataset, filter, query)` が `filter === 'budget'` をサポート

- [x] **Step 1: 失敗するテストを書く**

```js
assert.deepEqual(
  memorySpecConflict({ title: 'EliteBook 16GB 1TB', reasons: ['32GB内存'] }),
  { conflict: true, label: 'タイトル16GB / 検出32GB・要確認' },
);
assert.equal(isDisplayQualified({ shouldAlert: true, conditionEligible: true, title: '16GB', reasons: ['32GB内存'] }), false);
assert.equal(matchesResultRow({ budget: '1', match: '0', grade: '2', new: '0', search: 'HP' }, 'budget', ''), true);
```

- [x] **Step 2: テストを実行して失敗を確認**

Run: `node test-results-page.mjs`
Expected: 新しいエクスポートと予算フィルターが存在しないため失敗。

- [x] **Step 3: 最小実装を書く**

タイトルメモリ抽出・UI限定の適合判定・`matchesResultRow` の `budget` 分岐を実装。

- [x] **Step 4: テストを実行して通過を確認**

Run: `node test-results-page.mjs`
Expected: Task 1 のアサーションで PASS。

### Task 2: 情報階層とテーブル再構成

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Consumes: `memorySpecConflict(entry)`, `isDisplayQualified(entry)`
- Produces: コンパクトなフィルター指標・予算フィルター・現在の最有力候補バー・8列の判断テーブル

- [x] **Step 1: 失敗する描画アサーションを書く**

```js
assert.match(rendered, /data-filter="budget">予算内 ≤ ¥95,000/);
assert.match(rendered, /<th[^>]*>判定/);
assert.match(rendered, /class="decision-cell"/);
assert.match(rendered, /現在の最有力候補/);
assert.match(rendered, /いいね数/);
assert.match(rendered, /colspan="8"/);
```

- [x] **Step 2: テストを実行して失敗を確認**

Run: `node test-results-page.mjs`
Expected: 新しいレイアウトのマークアップが無いため失敗。

- [x] **Step 3: レイアウトを実装**

4つの大きな概要カードをコンパクトなフィルターボタンへ置換。価格のサブラインと判定列を追加。最有力候補を独立した目立つバーへ移動。商品タイトルを2行まで許可し、商品列を柔軟に。

- [x] **Step 4: テストを実行して通過を確認**

Run: `node test-results-page.mjs`
Expected: 新しいレイアウト契約で PASS。

### Task 3: 時刻・状態・レスポンシブ・最終検証

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Produces: `formatJstShort(value): { short: string, full: string }`
- Updates: ワンショットの `renderMonitorStatus(status)` のコピー（タイマー追加なし）

- [x] **Step 1: 失敗する時刻・状態アサーションを書く**

```js
assert.deepEqual(formatJstShort('2026-08-12T03:00:00.000Z'), {
  short: '08-12 12:00',
  full: '2026/08/12 12:00',
});
assert.match(rendered, /バックグラウンド正常｜前回チェック/);
assert.match(rendered, /@media \(max-width: 920px\)/);
```

- [x] **Step 2: テストを実行して失敗を確認**

Run: `node test-results-page.mjs`
Expected: 短いタイムスタンプと新しい状態コピーが無いため失敗。

- [x] **Step 3: 時刻・文言・アクセシビリティ・レスポンシブルールを実装**

コンパクトな可視JSTタイムスタンプと完全なtitleを使用し、補助テキストを12pxへ引き上げ、アクティブソートのスタイルを強化し、パルス状態アニメーションを削除し、狭い幅で優先度の低い列を非表示。

- [x] **Step 4: 対象・完全検証を実行**

Run: `node test-results-page.mjs`

Run: `npm test`

Run: `npm run check`

Expected: すべてのコマンドが失敗なく exit 0。

- [x] **Step 5: ページを生成して検査**

既存の結果ページ生成パスをローカルデータで実行し、デスクトップと狭いビューポートのスクリーンショットを撮り、最有力候補・予算フィルター・判定列・矛盾警告・レスポンシブ非表示が判読できることを確認。
