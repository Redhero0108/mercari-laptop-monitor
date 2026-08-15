# 十分钟静默监控设计

## 目标

用户只需双击 `open-results.cmd`。启动窗口应尽快消失并打开 `results.html`；隐藏后台监控继续运行，但搜索新品、刷新现有商品资料和结果页面自动重载都统一为每 10 分钟一次。等待期间不得再进行结果页每 10 秒状态轮询或监控器的高频心跳文件写入。

## 已确认的交互

1. 双击 `open-results.cmd` 后，由现有 `start-background.ps1` 幂等启动隐藏监控；若监控已运行，则不重复启动。
2. `results.html` 随即由默认浏览器打开，CMD 窗口退出。
3. 监控启动后立即执行首轮检查，之后每 10 分钟搜索一次新品，并每 10 分钟刷新一次现有商品的价格、いいね、状态与在售情况。
4. 结果页每 600 秒自动重载一次；搜索、筛选和排序继续通过 `localStorage` 跨重载保留。
5. 页面不提供手动同步按钮，也不再每 10 秒动态载入 `monitor-status.js`。

## 实现边界

- 将 `config.json` 的 `pollMinutes` 从 5 改为 10；`likesRefreshMinutes` 保持 10。
- 将 `monitor.mjs` 的缺省 `pollMinutes` 和无效配置回退值同步改为 10，避免缺失配置时退回 5 分钟。
- 将 `results-page.mjs` 的 HTML 自动刷新周期从 300 秒改为 600 秒，并更新页头说明。
- 页面加载时只读取一次 `monitor-status.js`，删除 10 秒 `setInterval`。
- 监控状态只在启动、阶段变化、检查完成和停止时写入；删除等待期间每 20 秒写文件的心跳定时器。页面判断状态过期的窗口调整为大于一个完整周期，避免正常等待时误报离线。
- 保留 `start-monitor.cmd`、`stop-background.cmd` 和显式一次性检查模式的现有功能；不新增依赖，不改变筛选、提醒或商品数据格式。

## 异常与资源行为

- `start-background.ps1` 继续通过 `monitor.pid` 防止重复启动。
- 后台检查失败时记录日志，并在下一个 10 分钟周期重试。
- 页面自动刷新只重读本地 `results.html`，不会单独请求 Mercari；Mercari 网络访问仅由后台检查触发。
- 如果后台进程意外退出，状态信息会在超过 15 分钟未更新后显示为离线；用户可重新双击 `open-results.cmd` 恢复。

## 验证

- 页面渲染测试断言 `content="600"`、十分钟说明存在、10 秒轮询不存在。
- 配置/源码测试断言搜索与现有商品刷新周期均为 10 分钟，且不存在高频心跳 `setInterval`。
- PowerShell 解析测试确保启动/停止脚本仍兼容 Windows PowerShell 5.1。
- 运行完整 `npm test` 与 `npm run check`，再重新生成本地 `results.html` 检查最终产物。
