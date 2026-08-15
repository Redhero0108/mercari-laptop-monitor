# メルカリ高性价比笔记本监测器

监测メルカリ刚上架的Windows笔记本，并围绕以下目标自动评分：

- 编程＋云端AI
- 32GB内存
- 512GB以上SSD（1TB额外加分）
- Intel第12代以上（同时接受更新的Core Ultra；不接受Ryzen/AMD）
- 系列只接受ThinkPad X1 Carbon、HP ProBook、Dell Precision、Panasonic Let's note、Dynabook G83
- 价格达到¥100,000的商品不进入结果列表（最高保留¥99,999）
- 商品状态只接受第1～3级（新品、未使用／未使用に近い／目立った傷や汚れなし）
- 排除Celeron、JUNK／ジャンク、部品取り、破损、锁机等高风险商品

当新商品达到阈值时，Windows会弹出提示；选择“是”即可打开商品页面。程序只读取公开商品页面，不登录、不留言、不收藏、更不会自动购买。

商品页面明确显示已删除、公开停止，或返回HTTP 404／410时，会从结果记录中自动剔除；普通网络失败不会误删商品。商品状态只保留第1、2、3级，第4级及以后（以及无法确认状态的商品）不会进入结果列表。
商品页面明确显示“売り切れました”时也会自动剔除。正常监测会分批复查旧记录，也可使用 `--prune-inactive` 一次清查全部结果。

## 全局命令 `mercari-watch`

在本目录打开PowerShell，执行一次：

```powershell
npm link
```

之后可以在任意目录调用：

```powershell
# 环境诊断（包含Mercari连通性检查）
mercari-watch doctor

# 列出监控任务及其稳定任务ID
mercari-watch tasks list

# 添加关键词；先预览，不修改config.json
mercari-watch keywords add "32GB 1TB 第12世代 ノートPC" --dry-run

# 确认后实际添加
mercari-watch keywords add "32GB 1TB 第12世代 ノートPC"

# 修改或删除一条；可使用tasks list显示的任务ID，也可使用完整旧关键词
mercari-watch keywords update query-xxxxxxxxxxxx "32GB 1TB 第13世代 ノートPC" --dry-run
mercari-watch keywords remove query-xxxxxxxxxxxx --dry-run

# 清空全部关键词必须明确确认
mercari-watch keywords clear --dry-run
mercari-watch keywords clear --yes

# 原子替换全部关键词：先预览，确认无误后把--dry-run改为--yes
mercari-watch keywords replace-all `
  --keyword "X1 Carbon 32GB" `
  --keyword "HP ProBook 32GB" `
  --keyword "Dell Precision 32GB" `
  --keyword "レッツノート 32GB" `
  --keyword "dynabook G83 32GB" `
  --dry-run

# 启动一次检查；默认不弹通知
mercari-watch check

# 查看最近20件，以及按商品ID读取一件
mercari-watch results recent --limit 20
mercari-watch results get m12345678901
```

自动化脚本请加全局参数 `--json`。stdout只输出一个稳定JSON对象；成功结构为
`{"ok":true,"command":"...","data":{},"meta":{"schemaVersion":"1","cliVersion":"1.1.0"}}`，失败结构为
`{"ok":false,"command":"...","error":{"code":"...","message":"..."},"meta":{...}}`。错误时进程返回非零退出代码。

```powershell
mercari-watch --json tasks list
mercari-watch --json results recent --limit 10
mercari-watch --json doctor --offline
```

高级排查可把原监控参数放在 `--` 后面，例如：

```powershell
mercari-watch monitor run -- --diagnose --show-browser
```

CLI不需要登录或API密钥，只读取公开商品并管理本机配置。它没有购买或联系卖家的命令；`check`默认也不会发送通知，只有明确加 `--notify` 才会沿用通知功能。全局命令通过npm链接到当前源码目录，如果以后移动本文件夹，需要在新位置重新执行 `npm link`。

关键词的 `add`、`update`、`remove`、`clear`、`replace-all` 都支持 `--dry-run`。单条修改和删除按稳定任务ID或完整关键词定位；清空与批量替换会影响全部搜索任务，真正执行时必须使用 `--yes`。批量替换只写入一次配置文件，不会出现“先清空成功、后添加失败”的中间状态。修改搜索关键词不会自动删除旧的商品结果或去重历史。

## 启动

双击：

```text
start-monitor.cmd
```

首次运行只记录当前商品作为基线，不弹旧商品；以后默认每10分钟检查新上架商品。窗口保持开启即可，按 `Ctrl+C` 停止。

查看可点击结果：双击 `open-results.cmd`。启动窗口会很快消失，同时在需要时启动隐藏的后台监测器并打开结果页；如需停止，双击 `stop-background.cmd`。浏览器结果页中的商品标题可直接跳转到メルカリ，页面每10分钟刷新一次。页头状态灯只在页面载入时读取一次后台状态，不再每10秒轮询；后台等待期间也不持续写入心跳文件。后台每10分钟检查新商品，并复查全部商品的当前价格、いいね数、商品状态及是否已售出，等待下一轮时保持空闲。刷新旧商品时使用3个页面并行缩短等待时间。いいね数字旁的绿点表示最近更新成功，金点表示正在等待刷新；鼠标停留可查看最后更新时间。

结果页可按品牌、型号、CPU、商品状态或判断理由即时搜索；多个空格分隔词必须同时命中，并可与“只看符合、S/A级、24H新增”组合使用。搜索词、快捷筛选和排序会在自动刷新后保留。紧凑表格保留“等级、价格、いいね数、商品状态、商品、发布时间、检查时间”七列，点击栏目名称可切换升序／降序。符合商品显示绿色标签；未达提醒线的商品会优先显示“超预算、未确认内存/SSD、故障风险”等主要阻断原因，完整理由仍可在商品说明中查看。页面只显示S/A/B/C等级，原始评分仅在程序内部用于筛选和排序。

## 先进行诊断

诊断模式会读取当前商品、显示评分，但不发送通知，也不修改去重记录：

```powershell
.\start-monitor.cmd --diagnose
```

其他选项：

```powershell
# 只检查一次
.\start-monitor.cmd --once

# 首次运行也检查并提醒当前商品
.\start-monitor.cmd --once --alert-existing

# 显示浏览器，方便排查网页加载问题
.\start-monitor.cmd --diagnose --show-browser

# 不弹Windows通知
.\start-monitor.cmd --no-notify

# 一次补查全部旧记录的いいね数、商品状态和发布时间，不发送提醒
.\start-monitor.cmd --refresh-metadata

# 立即刷新全部现有商品的价格、いいね数、商品状态和在售状态
.\start-monitor.cmd --refresh-likes

# 一次检查并剔除全部已售出、已删除或公开停止的商品
.\start-monitor.cmd --prune-inactive
```

## 调整筛选条件

编辑 `config.json`：

- `pollMinutes`：检查间隔，当前默认10分钟，最低2分钟。
- `maxPriceYen`：最高提醒价格，默认¥95,000。
- `maxResultPriceYen`：结果列表最高价格，当前¥99,999；¥100,000及以上商品会自动剔除。
- `minScore`：最低提醒评分，默认58；提高到65会更严格。
- `minIntelGeneration`：Intel最低世代，当前为12。
- `intelOnly`：当前为`true`，只接受Intel第12代以上及Core Ultra，不接受Ryzen/AMD。
- `minRyzenSeries`：仅当把`intelOnly`改为`false`时生效。
- `maxConditionLevel`：允许的最高商品状态级别，当前为3；只接受第1～3级。
- `allowedSeries`：最终结果允许的商务本系列ID；当前固定为上述五个系列。
- `excludeKeywords`：在メルカリ搜索阶段直接排除的关键词。
- `detailCheckLimit`：每轮最多打开的新增商品详情数。
- `metadataRefreshLimit`：正常监测时每轮补查的旧记录数，默认5、最高10。
- `likesRefreshMinutes`：全部现有商品动态资料的刷新间隔，默认10分钟、最低5分钟。
- `likesRefreshConcurrency`：刷新旧商品时同时使用的页面数，默认3、最高5。
- `headless`：`true`表示浏览器在后台运行。
- `notify`：是否显示Windows通知。
- `queries`：メルカリ搜索关键词。

## 文件说明

- `state.json`：已见商品，避免重复提醒。
- `alerts.jsonl`：历史提醒记录，每行一个JSON对象。
- `monitor.log`：运行日志。
- `results.html`：浏览器版可点击结果页。
- `results.json`：结果页的数据，按商品编号去重并保留最近500件。

如需重新建立基线，先关闭程序，再手动删除 `state.json`。

## 注意事项

- 商品价格和描述由卖家提供，评分只是初筛，不代表商品一定可靠。
- 购买前仍需确认内存/SSD品牌、CrystalDiskInfo、电池健康、BIOS密码以及Autopilot/Intune企业管理状态。
- 不要把检查间隔改得过短，以免给网站造成不必要的请求压力。
