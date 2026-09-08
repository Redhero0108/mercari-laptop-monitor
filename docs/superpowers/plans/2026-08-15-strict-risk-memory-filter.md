# 厳格なリスク・メモリフィルター 実装計画

> **エージェントワーカー向け:** 必須サブスキル: superpowers:subagent-driven-development（推奨）または superpowers:executing-plans を使って、この計画をタスク単位で実装してください。手順はチェックボックス（`- [ ]`）構文で追跡します。

**目標:** タイトルが16GBのみ／32GBへ増設可能なだけの商品と、外観・画面の欠陥や深刻な故障・ロックのリスクがある商品を完全に除外する。

**アーキテクチャ:** `laptop-filters.mjs` に、純粋なタイトル判定とリスク判定を集中的に実装し、新規商品を書き込む前の `hardFilterFailure` と既存結果の `resultMatchesHardFilters` が同じルールを使うようにする。`monitor.mjs` は商品タイトルを中央フィルターへ渡し、明確な除外ログを表示するだけにする。

**テックスタック:** Node.js ESM、組み込み `node:assert/strict`、PowerShell、既存 Mercari monitor。

## グローバル制約

- 明示的な `32GB`・`16GB×2`・`16GBx2`・`16GB*2`・`16GB+16GB` の商品は保持する。
- 単独 `16GB`、または現在16GBで32GBへ増設可能と説明された商品は除外する。
- 理由に「外观或屏幕有缺陷」または「严重故障/锁机风险」を含む商品は除外する。
- 依存・バックグラウンドプロセス・チェック頻度は追加しない。単一プロセスと10分周期を維持する。

---

### Task 1: 中央ハードフィルタールール

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`

**Interfaces:**
- Produces: `titleHasDisallowed16GB(title: string): boolean`
- Extends: `hardFilterFailure(assessment, maxResultPriceYen, title): null | 'series' | 'memory' | 'storage' | 'ssd' | 'price' | 'risk'`
- Extends: `resultMatchesHardFilters(entry, allowedSeries, maxResultPriceYen): boolean`

- [ ] **Step 1: タイトルのメモリ・リスク拒否の失敗テストを書く**

単独16GBと増設可16GBが拒否され、明示的な32GBと16GB×2モジュールが通過し、両方のリスク理由が評価・永続化結果の両パスで拒否されることを示すアサーションを追加する。

- [ ] **Step 2: 対象テストを実行して RED を確認**

Run: `node .\test-laptop-filters.mjs`

Expected: 新しいタイトルヘルパーと厳格な拒否動作が存在しないため失敗する。

- [ ] **Step 3: 最小の集中ルールを実装**

既存の `compact` ヘルパーでタイトルを正規化する。単独16GBトークンを拒否として扱う前に、明示的な合計32GBを検出する。リスク理由の述語を追加し、`hardFilterFailure` と `resultMatchesHardFilters` の両方で同じ述語を再利用する。

- [ ] **Step 4: 対象テストを実行して GREEN を確認**

Run: `node .\test-laptop-filters.mjs`

Expected: `laptop filter tests: OK`。

### Task 2: モニター統合とライブ掃除

**Files:**
- Modify: `monitor.mjs`
- Test: `test-laptop-filters.mjs`

**Interfaces:**
- Consumes: `hardFilterFailure(assessment, maxResultPriceYen, title)`
- Produces: メタデータ更新・ライブ更新・新規検索結果で一貫した拒否判定。

- [ ] **Step 1: 各商品タイトルをハードフィルター判定へ渡す**

`hardFilterMessage` が `title` を受け取り、`risk` ログメッセージを追加し、結果を記録・通知する前の3箇所すべてで `detailed.title` または `item.title` を渡すよう変更する。

- [ ] **Step 2: 完全な自動検証を実行**

Run: `npm test`

Expected: すべてのスイートが `OK` を表示し exit 0。

Run: `npm run check`

Expected: すべての `node --check` コマンドが exit 0。

- [ ] **Step 3: 常駐プロセスを追加せずに現在の結果へルールを適用**

上限付きの `mercari-watch --json check` を1回実行し、`results.json` に不許可タイトルやリスク理由が含まれず、常駐 `monitor.mjs` プロセスがちょうど1つ残ることを確認する。

- [ ] **Step 4: 実装をコミット**

```powershell
git add -- laptop-filters.mjs test-laptop-filters.mjs monitor.mjs
git commit -m "feat: 剔除低内存与高风险商品"
```
