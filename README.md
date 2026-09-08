# メルカリノートパソコンリサーチ

メルカリに出品されたWindowsノートPCを監視し、以下の方針で自動スコアリングします。

- プログラミング＋クラウドAI
- 32GBメモリ
- 512GB以上のSSD（1TBは加点）。Panasonic Let's note は、明確に1TB超へ増設可能な256GB SSDも可
- Intel第12世代以上（新しい Core Ultra も可）。Intel第12世代相当以上の Ryzen 6000系以降も可
- シリーズは11種の高品質ビジネスノートのみ：ThinkPad X1 Carbon、HP ProBook、Dell Precision、Panasonic Let's note、Dynabook G83、LIFEBOOK U7412、高品質型 NEC VersaPro、ExpertBook B9、VAIO Pro、Latitude 5000/7000/9000、HP EliteBook
- ¥70,000以下かつ他条件を満たす場合のみ通知。¥70,001〜¥99,999は結果ページに参考表示のみ
- ¥100,000以上の商品は結果一覧に入れない（最高¥99,999まで）
- 商品状態は第1〜3級のみ（新品・未使用／未使用に近い／目立った傷や汚れなし）
- Celeron、JUNK／ジャンク、部品取り、破損、ロック等の高リスク商品は除外

新商品が条件を満たすとWindowsのポップアップが表示され、「はい」で商品ページを開けます。記録済みの商品が予算内へ値下がりし通知条件を満たした場合も、再度値下げ通知を出します。本ツールは公開商品ページの読み取りのみで、ログイン・コメント・いいね・自動購入は行いません。

商品ページで「削除済み」「公開停止中」が明示された場合、またはHTTP 404／410が返った場合は結果記録から自動除外します。単なる通信失敗では誤って削除しません。商品状態は第1・2・3級のみ保持し、第4級以降（および状態不明の商品）は結果一覧に入れません。
商品ページに「売り切れました」が明示された場合も自動除外します。通常監視では旧記録を分割して再確認し、`--prune-inactive` で全結果を一括精査することもできます。

## グローバルコマンド `mercari-watch`

このフォルダでPowerShellを開き、一度だけ実行：

```powershell
npm link
```

以後はどのディレクトリからでも呼び出せます：

```powershell
# 環境診断（Mercari接続確認を含む）
mercari-watch doctor

# 監視タスクと安定したタスクIDを一覧表示
mercari-watch tasks list

# キーワード追加。まずプレビュー（config.json は変更しない）
mercari-watch keywords add "32GB 1TB 第12世代 ノートPC" --dry-run

# 確認後に実際に追加
mercari-watch keywords add "32GB 1TB 第12世代 ノートPC"

# 1件を変更／削除。tasks list のタスクIDか、完全な旧キーワードで指定
mercari-watch keywords update query-xxxxxxxxxxxx "32GB 1TB 第13世代 ノートPC" --dry-run
mercari-watch keywords remove query-xxxxxxxxxxxx --dry-run

# 全キーワードのクリアは明示確認が必要
mercari-watch keywords clear --dry-run
mercari-watch keywords clear --yes

# 全キーワードを原子的に置換。まずプレビューし、問題なければ --dry-run を --yes に
mercari-watch keywords replace-all `
  --keyword "X1 Carbon 32GB" `
  --keyword "HP ProBook 32GB" `
  --keyword "Dell Precision 32GB" `
  --keyword "レッツノート 32GB" `
  --keyword "dynabook G83 32GB" `
  --keyword "LIFEBOOK U7412 32GB" `
  --keyword "NEC VersaPro 32GB" `
  --keyword "ExpertBook B9 32GB" `
  --keyword "VAIO Pro 32GB" `
  --keyword "Dell Latitude 32GB" `
  --keyword "HP EliteBook 32GB" `
  --dry-run

# 1回だけチェック実行（既定では通知なし）
mercari-watch check

# 直近20件の表示、および商品IDで1件取得
mercari-watch results recent --limit 20
mercari-watch results get m12345678901
```

自動化スクリプトではグローバルオプション `--json` を付けてください。stdoutには安定したJSONオブジェクトを1つだけ出力します。成功時は
`{"ok":true,"command":"...","data":{},"meta":{"schemaVersion":"1","cliVersion":"1.1.0"}}`、失敗時は
`{"ok":false,"command":"...","error":{"code":"...","message":"..."},"meta":{...}}` です。エラー時はプロセスが非ゼロの終了コードを返します。

```powershell
mercari-watch --json tasks list
mercari-watch --json results recent --limit 10
mercari-watch --json doctor --offline
```

高度な調査では `--` の後に元の監視パラメータを指定できます。例：

```powershell
mercari-watch monitor run -- --diagnose --show-browser
```

CLIはログインやAPIキーを必要とせず、公開商品の読み取りと本機設定の管理のみを行います。購入や出品者への連絡コマンドはありません。`check` も既定では通知を送らず、明示的に `--notify` を付けた場合のみ通知機能が有効です。グローバルコマンドはnpmリンクで現在のソースディレクトリに紐づくため、フォルダを移動した場合は新しい場所で再度 `npm link` を実行してください。

キーワードの `add`・`update`・`remove`・`clear`・`replace-all` はいずれも `--dry-run` に対応します。1件の変更・削除は安定したタスクIDまたは完全なキーワードで特定します。クリアと一括置換はすべての検索タスクに影響するため、実際に実行する際は `--yes` が必要です。一括置換は設定ファイルへ1回だけ書き込むため、「クリアは成功したが追加は失敗」のような途中状態は発生しません。検索キーワードを変更しても、既存の商品結果や重複防止履歴は自動では削除されません。

## 起動

ダブルクリック：

```text
start-monitor.cmd
```

初回実行では現在の商品をベースラインとして記録するだけで、既存商品の通知は行いません。以後は既定で10分ごとに新規出品をチェックします。ウィンドウは開いたままにし、`Ctrl+C` で停止します。

クリック可能な結果を表示するには `open-results.cmd` をダブルクリックしてください。起動ウィンドウはすぐ消えますが、必要に応じて隠しバックグラウンドモニターを起動して結果ページを開きます。停止するには `stop-background.cmd` をダブルクリックします。結果ページの商品タイトルからメルカリへ直接ジャンプでき、ページは10分ごとに自動更新されます。ヘッダーの状態ランプはページ読み込み時に一度だけバックグラウンド状態を読み取り、10秒ごとのポーリングは行いません。バックグラウンド待機中もハートビートファイルへ連続書き込みはしません。バックグラウンドは10分ごとに新商品をチェックし、全商品の現在価格・いいね数・商品状態・売却済みかどうかを再確認して、次ラウンドまではアイドル状態です。旧商品の更新は3ページの並列で待ち時間を短縮します。いいね数の横にある緑点は直近で正常更新、金点は更新待ちを示し、マウスを置くと最終更新日時を確認できます。

結果ページはブランド・型番・CPU・商品状態・判定理由で即時検索できます。空白区切りの複数語はすべて一致する必要があり、「通知条件合致」「S/Aランク」「24H変動」などのクイックフィルターと組み合わせられます。検索語・クイックフィルター・並び順は自動更新後も保持されます。コンパクトな表は「ランク・価格・いいね数・商品状態・商品・出品日時・確認日時」の7列を保ち、列名クリックで昇順／降順を切り替えられます。条件合致商品は緑ラベルで表示し、通知基準に満たない商品は「予算超過・メモリ/SSD未確認・故障リスク」などの主要なブロック理由を優先表示します。完全な理由は商品の説明で確認できます。ページはS/A/B/Cランクのみを表示し、素点スコアはプログラム内部の絞り込み・並び替えにのみ使います。

## まず診断する

診断モードは現在の商品を読み取りスコアを表示しますが、通知は送らず、重複防止記録も変更しません：

```powershell
.\start-monitor.cmd --diagnose
```

その他のオプション：

```powershell
# 1回だけチェック
.\start-monitor.cmd --once

# 初回実行でも現在の商品をチェックして通知
.\start-monitor.cmd --once --alert-existing

# ブラウザを表示してページ読み込みを調査
.\start-monitor.cmd --diagnose --show-browser

# Windows通知を出さない
.\start-monitor.cmd --no-notify

# 全旧記録のいいね数・商品状態・出品日時を一括で補完（通知なし）
.\start-monitor.cmd --refresh-metadata

# 全既存商品の価格・いいね数・商品状態・在庫状態を即時更新
.\start-monitor.cmd --refresh-likes

# 売却済み・削除済み・公開停止の商品を一括でチェックして除外
.\start-monitor.cmd --prune-inactive
```

## 絞り込み条件の調整

`config.json` を編集します：

- `pollMinutes`：チェック間隔。現在は既定10分、最低2分。
- `maxPriceYen`：通知する最高価格。現在¥70,000。¥70,001〜¥99,999は表示のみで通知しません。
- `maxResultPriceYen`：結果一覧の最高価格。現在¥99,999。¥100,000以上は自動除外。
- `minScore`：通知する最低スコア。既定58。65へ上げるとより厳しくなります。
- `minIntelGeneration`：Intelの最低世代。現在12。
- `intelOnly`：現在`false`。Intel第12世代以上・Core Ultra・基準を満たすRyzen/AMDを受け入れます。
- `minRyzenSeries`：現在`6`。Ryzen 6000系以降。Ryzen 5000以下しか認識できない商品は通過させません。
- `maxConditionLevel`：許可する最高の商品状態レベル。現在3。第1〜3級のみ受け入れます。
- `allowedSeries`：最終結果に許可するビジネスノートのシリーズID。現在は上記11種の高品質ビジネスノートに固定。Latitudeは5000/7000/9000系のみ、VersaProはUltraLiteまたはタイプVN/VG/VH/VMと明記された高級モバイル系のみ、LIFEBOOK・ExpertBookはそれぞれU7412・B9のみ許可します。
- `excludeKeywords`：メルカリ検索段階で直接除外するキーワード。
- `detailCheckLimit`：1ラウンドで開く新規商品詳細の最大数。既定30、最大80。
- `metadataRefreshLimit`：通常監視で1ラウンドに補完する旧記録数。既定5、最大10。
- `likesRefreshMinutes`：全既存商品の動的資料の更新間隔。既定10分、最低5分。
- `likesRefreshConcurrency`：旧商品更新時に同時に使うページ数。既定3、最大5。
- `searchConcurrency`：検索キーワード実行時に同時に使うページ数。既定3、最大5。
- `headless`：`true`でブラウザをバックグラウンド実行。
- `notify`：Windows通知を表示するか。
- `queries`：メルカリ検索キーワード。
- `wideQueries`：広域検索キーワード（「32GB」を含まない）。タイトルに容量がないが詳細ページに32GBが含まれる商品を回収するためのもので、広域検索の結果も詳細を開き、スコアリングとハードフィルターを通過したものだけが結果一覧に入ります。

## ファイルの説明

- `state.json`：既視の商品（重複通知の防止）。
- `alerts.jsonl`：過去の通知記録。1行ごとに1つのJSONオブジェクト。
- `monitor.log`：実行ログ。
- `results.html`：ブラウザで開くクリック可能な結果ページ。
- `results.json`：結果ページ用データ。商品IDで重複排除し、直近500件を保持。

ベースラインを作り直す場合は、まずプログラムを停止してから手動で `state.json` を削除してください。

## 注意事項

- 商品価格・説明は出品者が提供するもので、スコアはあくまで一次スクリーニングであり、商品の信頼性を保証するものではありません。
- 購入前には、メモリ/SSDのブランド、CrystalDiskInfo、バッテリーの健全性、BIOSパスワード、Autopilot/Intuneの企業管理状態などを必ず確認してください。
- チェック間隔を過度に短くするとサイトへ不要な負荷をかけるため、注意してください。
