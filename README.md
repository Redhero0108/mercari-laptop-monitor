# メルカリ高性价比笔记本监测器

监测メルカリ刚上架的Windows笔记本，并围绕以下目标自动评分：

- 编程＋云端AI
- 32GB内存
- 512GB以上SSD（1TB额外加分）
- Intel第10代以上（或Ryzen 5000系列以上）
- 排除Celeron、JUNK／ジャンク、部品取り、破损、锁机等高风险商品

当新商品达到阈值时，Windows会弹出提示；选择“是”即可打开商品页面。程序只读取公开商品页面，不登录、不留言、不收藏、更不会自动购买。

## 启动

双击：

```text
start-monitor.cmd
```

首次运行只记录当前商品作为基线，不弹旧商品；以后默认每5分钟检查新上架商品。窗口保持开启即可，按 `Ctrl+C` 停止。

查看可点击结果：双击 `open-results.cmd`。浏览器结果页中的商品标题和“打开商品”按钮都可直接跳转到メルカリ，并且每30秒自动刷新。页面会显示日本时间的商品发布时间（精确到分钟）；无法从商品图片取得可靠时间戳时显示“无法取得”。点击“等级、价格、商品、判断、发布时间、检查时间”可切换升序／降序，排序选择会自动保留。页面只显示S/A/B/C等级，原始评分仅在程序内部用于筛选和排序。

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
```

## 调整筛选条件

编辑 `config.json`：

- `pollMinutes`：检查间隔，最低2分钟；建议保持5分钟或更长。
- `maxPriceYen`：最高提醒价格，默认¥95,000。
- `minScore`：最低提醒评分，默认58；提高到65会更严格。
- `minIntelGeneration`：Intel最低世代，当前为10。
- `minRyzenSeries`：Ryzen最低系列，当前为5（5000系列）。
- `excludeKeywords`：在メルカリ搜索阶段直接排除的关键词。
- `detailCheckLimit`：每轮最多打开的新增商品详情数。
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
