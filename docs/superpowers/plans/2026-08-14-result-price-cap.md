# Mercari Result Price Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将价格达到或超过 100,000 日元的 Mercari 商品从提醒、结果数据和网页列表中自动剔除。

**Architecture:** 保留 `maxPriceYen: 95000` 作为提醒线，新增 `maxResultPriceYen: 99999` 作为结果硬上限。扩展现有 `laptop-filters.mjs` 的统一硬过滤接口，让新品、旧记录、实时刷新和页面重建共享同一价格判断，避免各路径规则不一致。

**Tech Stack:** Node.js ES modules、内置 `node:assert`、PowerShell、全局 `mercari-watch` CLI。

## Global Constraints

- 价格 `99,999` 日元及以下允许进入结果；价格 `100,000` 日元及以上必须剔除。
- 价格未知不因本规则单独删除，但不能达到现有提醒条件。
- `maxPriceYen: 95000` 保持不变。
- 五个商务系列、32GB、512GB SSD、Intel 12代以上、商品状态1～3、JUNK和已售剔除规则保持不变。
- 程序只读取公开商品，不购买、不收藏、不联系卖家。
- 保持 Windows 10 和 PowerShell 兼容，不增加依赖。

---

### Task 1: 扩展统一硬过滤规则

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`

**Interfaces:**
- Consumes: `assessment.price`、持久化结果的 `entry.price`、数值型 `maxResultPriceYen`。
- Produces: `hardFilterFailure(assessment, maxResultPriceYen)` 在超价时返回 `'price'`；`resultMatchesHardFilters(entry, allowedSeries, maxResultPriceYen)` 对新旧结果使用相同边界。

- [ ] **Step 1: 写入价格边界失败测试**

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

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node test-laptop-filters.mjs`

Expected: `100000` 日元用例得到 `null` 或高价旧结果得到 `true`，证明价格规则尚未实现。

- [ ] **Step 3: 实现最小价格判断**

在 `hardFilterFailure` 的现有系列、内存、容量、SSD判断之后加入：

```js
if (Number.isFinite(assessment?.price) && assessment.price > maxResultPriceYen) return 'price';
```

在 `resultMatchesHardFilters` 中计算并合并：

```js
const priceEligible = !Number.isFinite(entry?.price) || entry.price <= maxResultPriceYen;
return seriesEligible && has32GB && has512GB && hasSSD && priceEligible;
```

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run: `node test-laptop-filters.mjs`

Expected: `laptop filter tests: OK`

### Task 2: 接入监控配置和所有处理路径

**Files:**
- Modify: `monitor.mjs`
- Modify: `config.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 的两个扩展函数以及 `config.maxResultPriceYen`。
- Produces: 新品、旧记录补查、实时刷新、结果页重建均剔除价格达到10万日元的商品。

- [ ] **Step 1: 增加并规范化结果价格配置**

在默认配置和 `config.json` 中增加：

```json
"maxResultPriceYen": 99999
```

在配置加载后规范化为正整数，缺失或无效时回退到 `99999`。

- [ ] **Step 2: 把价格上限传入统一过滤函数**

```js
hardFilterFailure(assessment, config.maxResultPriceYen)
resultMatchesHardFilters(entry, config.allowedSeries, config.maxResultPriceYen)
```

并在 `HARD_FILTER_MESSAGES` 中增加：

```js
price: '价格达到或超过10万日元',
```

- [ ] **Step 3: 更新中文使用说明**

在目标条件和配置说明中明确：`maxResultPriceYen` 当前为 `99,999`，因此 `100,000` 日元及以上商品不会进入结果列表；`maxPriceYen` 仍为 `95,000` 的提醒线。

- [ ] **Step 4: 运行完整验证**

Run: `npm test`

Expected: 所有测试脚本输出 `OK`，命令退出代码为0。

Run: `npm run check`

Expected: 所有 Node.js 语法检查退出代码为0。

Run: `git diff --check`

Expected: 退出代码为0且无空白错误。

- [ ] **Step 5: 创建中文实现提交**

```powershell
git add -- README.md config.json laptop-filters.mjs monitor.mjs test-laptop-filters.mjs
git commit -m "feat: 剔除10万日元以上Mercari商品" -m "新增独立的结果价格上限，保持现有9.5万日元提醒线不变，并让新旧结果统一执行价格硬过滤。"
```

### Task 3: 载入配置并验证实际运行

**Files:**
- Runtime state only: `monitor.pid`、`monitor-status.js`、`results.json`、`results.html`、`monitor.log`

**Interfaces:**
- Consumes: 项目自带的 `stop-background.ps1`、`start-background.ps1` 和 `mercari-watch` 只读命令。
- Produces: 正在运行的新监控进程和已清理的结果页。

- [ ] **Step 1: 使用项目脚本重启后台监控器**

```powershell
& .\stop-background.ps1
& .\start-background.ps1
```

- [ ] **Step 2: 等待状态回到待机并检查日志**

读取 `monitor-status.js`，要求 `running` 为 `true` 且消息最终为“等待下一轮检查”。检查日志中没有启动错误。

- [ ] **Step 3: 通过全局命令核对配置与结果**

```powershell
mercari-watch --json doctor --offline
mercari-watch --json config show
mercari-watch --json results recent --limit 200
```

要求 `doctor.data.ready` 为 `true`、`maxResultPriceYen` 为 `99999`，且最近结果中不存在 `priceYen >= 100000` 的商品。

- [ ] **Step 4: 确认最终Git和运行状态**

```powershell
git status --short
git log -1 --oneline
```

要求工作区干净，最新实现提交存在，后台监控器继续运行。
