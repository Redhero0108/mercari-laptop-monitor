# Mercari 結果価格上限 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** 価格が 100,000 円以上になった Mercari 商品を、通知・結果データ・Web一覧から自動的に除外する。

**アーキテクチャ:** `maxPriceYen: 95000` を通知ラインとして残し、`maxResultPriceYen: 99999` を結果のハード上限として新設する。既存の `laptop-filters.mjs` の統一ハードフィルターインターフェースを拡張し、新規商品・旧記録・リアルタイム更新・ページ再構築が同じ価格判定を共有して、各パスの規則が食い違わないようにする。

**テックスタック:** Node.js ES modules、組み込み `node:assert`、PowerShell、グローバル `mercari-watch` CLI。

## グローバル制約

- 価格 `99,999` 円以下は結果への掲載を許可。価格 `100,000` 円以上は必ず除外。
- 価格不明は本ルール単独では削除しないが、既存の通知条件には到達できない。
- `maxPriceYen: 95000` は変更しない。
- 5つのビジネスシリーズ・32GB・512GB SSD・Intel第12世代以上・商品状態1〜3・JUNK・売却済み除外の規則は変更しない。
- プログラムは公開商品の読み取りのみで、購入・いいね・出品者への連絡はしない。
- Windows 10とPowerShell互換を維持し、依存を増やさない。

---

### Task 1: 統一ハードフィルタールールの拡張

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`

**Interfaces:**
- Consumes: `assessment.price`・永続化結果の `entry.price`・数値型 `maxResultPriceYen`。
- Produces: `hardFilterFailure(assessment, maxResultPriceYen)` が超過時に `'price'` を返す。`resultMatchesHardFilters(entry, allowedSeries, maxResultPriceYen)` が新旧結果で同じ境界を使う。

- [ ] **Step 1: 価格境界の失敗テストを書く**

```js
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: 99999 }, 99999), null);
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: 100000 }, 99999), 'price');
assert.equal(filters.hardFilterFailure({ ...eligibleAssessment, price: null }, 99999), null);

assert.equal(filters.resultMatchesHardFilters({
  title: 'HP ProBook 450 G9',
  seriesId: 'hp-probook',
  has32GB: true,
  has512GB: true,
  hasSSD: true,
  price: 100000,
}, allowedSeries, 99999), false);
```

- [ ] **Step 2: テストを実行し、意図どおり失敗することを確認**

Run: `node test-laptop-filters.mjs`

Expected: `100000` 円のケースで `null` が返る、または高額旧結果が `true` を返すなど、価格ルールが未実装であることを示す。

- [ ] **Step 3: 最小の価格判定を実装**

`hardFilterFailure` の既存のシリーズ・メモリ・容量・SSD判定の後に追加：

```js
if (Number.isFinite(assessment?.price) && assessment.price > maxResultPriceYen) return 'price';
```

`resultMatchesHardFilters` で計算して統合：

```js
const priceEligible = !Number.isFinite(entry?.price) || entry.price <= maxResultPriceYen;
return seriesEligible && has32GB && has512GB && hasSSD && priceEligible;
```

- [ ] **Step 4: 対象テストを実行して通過を確認**

Run: `node test-laptop-filters.mjs`

Expected: `laptop filter tests: OK`

### Task 2: 監視設定とすべての処理パスへの組み込み

**Files:**
- Modify: `monitor.mjs`
- Modify: `config.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 の2つの拡張関数と `config.maxResultPriceYen`。
- Produces: 新規商品・旧記録補完・リアルタイム更新・結果ページ再構築のすべてで10万円の商品を除外。

- [ ] **Step 1: 結果価格設定を追加して正規化**

既定設定と `config.json` に追加：

```json
"maxResultPriceYen": 99999
```

設定ロード後に正の整数へ正規化し、欠落・無効時は `99999` へフォールバック。

- [ ] **Step 2: 価格上限を統一フィルター関数へ渡す**

```js
hardFilterFailure(assessment, config.maxResultPriceYen)
resultMatchesHardFilters(entry, config.allowedSeries, config.maxResultPriceYen)
```

`HARD_FILTER_MESSAGES` に追加：

```js
price: '价格达到或超过10万日元',
```

- [ ] **Step 3: 使用説明（中文）を更新**

目標条件と設定の説明で明示：`maxResultPriceYen` は現在 `99,999` のため、`100,000` 円以上の商品は結果一覧に入らない。`maxPriceYen` は引き続き `95,000` の通知ライン。

- [ ] **Step 4: 完全な検証を実行**

Run: `npm test`

Expected: すべてのテストスクリプトが `OK` を出力し、コマンドの終了コードが0。

Run: `npm run check`

Expected: すべてのNode.js構文チェックの終了コードが0。

Run: `git diff --check`

Expected: 終了コードが0で空白エラーなし。

- [ ] **Step 5: 実装をコミット**

```powershell
git add -- README.md config.json laptop-filters.mjs monitor.mjs test-laptop-filters.mjs
git commit -m "feat: 剔除10万日元以上Mercari商品" -m "新しい独立した結果価格上限を追加し、既存の9.5万円の通知ラインを維持しつつ、新旧結果が同じ価格ハードフィルターを実行するようにした。"
```

### Task 3: 設定を読み込み、実動作を検証

**Files:**
- Runtime state only: `monitor.pid`、`monitor-status.js`、`results.json`、`results.html`、`monitor.log`

**Interfaces:**
- Consumes: プロジェクト同梱の `stop-background.ps1`、`start-background.ps1`、`mercari-watch` 読み取り専用コマンド。
- Produces: 実行中の新しい監視プロセスと、掃除済みの結果ページ。

- [ ] **Step 1: プロジェクトスクリプトでバックグラウンドモニターを再起動**

```powershell
& .\stop-background.ps1
& .\start-background.ps1
```

- [ ] **Step 2: 状態が待機に戻るのを待ち、ログを確認**

`monitor-status.js` を読み、`running` が `true` で、最終的にメッセージが「次のチェックを待機中」であること。ログに起動エラーがないこと。

- [ ] **Step 3: グローバルコマンドで設定と結果を確認**

```powershell
mercari-watch --json doctor --offline
mercari-watch --json config show
mercari-watch --json results recent --limit 200
```

`doctor.data.ready` が `true`、`maxResultPriceYen` が `99999`、直近結果に `priceYen >= 100000` の商品がないこと。

- [ ] **Step 4: 最終的なGitと実行状態を確認**

```powershell
git status --short
git log -1 --oneline
```

ワークツリーがクリーンで、最新の実装コミットが存在し、バックグラウンドモニターが継続動作していること。
