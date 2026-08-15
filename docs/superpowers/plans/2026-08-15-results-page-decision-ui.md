# Results Page Decision UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将结果页改造成更紧凑、可信且能快速判断购买价值的操作界面，完整落实已批准的八项前端改进。

**Architecture:** 保持 `results-page.mjs` 的服务端字符串生成方式，增加可单测的规格矛盾与时间格式化纯函数，再重排同一文件内的 HTML、CSS 和轻量脚本。所有筛选仍在浏览器本地完成，不新增依赖、请求或后台计时器。

**Tech Stack:** Node.js ESM、原生 HTML/CSS/JavaScript、`node:assert/strict`

## Global Constraints

- 维持页面 meta refresh 600 秒和后台每 10 分钟检查。
- 不新增持续轮询、计时器、动画库或第三方依赖。
- 规格矛盾只影响前端“符合提醒”展示，不修改后台监测数据。
- 页面提醒预算读取 `config.maxPriceYen`，缺省值为 ¥70,000。
- 保留用户现有本地搜索、筛选和排序记忆。

---

### Task 1: 决策与筛选数据模型

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Produces: `memorySpecConflict(entry): { conflict: boolean, label: string }`
- Produces: `isDisplayQualified(entry): boolean`
- Extends: `matchesResultRow(dataset, filter, query)` 支持 `filter === 'budget'`

- [x] **Step 1: Write the failing tests**

```js
assert.deepEqual(
  memorySpecConflict({ title: 'EliteBook 16GB 1TB', reasons: ['32GB内存'] }),
  { conflict: true, label: '标题16GB / 检测32GB · 需要人工确认' },
);
assert.equal(isDisplayQualified({ shouldAlert: true, conditionEligible: true, title: '16GB', reasons: ['32GB内存'] }), false);
assert.equal(matchesResultRow({ budget: '1', match: '0', grade: '2', new: '0', search: 'HP' }, 'budget', ''), true);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test-results-page.mjs`
Expected: FAIL because the new exports and budget filter do not exist.

- [x] **Step 3: Write minimal implementation**

Implement title-memory extraction, UI-only qualification, and the `budget` branch in `matchesResultRow`.

- [x] **Step 4: Run test to verify it passes**

Run: `node test-results-page.mjs`
Expected: PASS for Task 1 assertions.

### Task 2: 信息层级与表格重排

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Consumes: `memorySpecConflict(entry)`, `isDisplayQualified(entry)`
- Produces: compact filter metrics, budget filter, current-best strip, 8-column decision table

- [x] **Step 1: Write the failing render assertions**

```js
assert.match(rendered, /data-filter="budget">预算内 ≤ ¥95,000/);
assert.match(rendered, /<th[^>]*>判断/);
assert.match(rendered, /class="decision-cell"/);
assert.match(rendered, /当前最佳候选/);
assert.match(rendered, /收藏数（いいね）/);
assert.match(rendered, /colspan="8"/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test-results-page.mjs`
Expected: FAIL on missing new layout markup.

- [x] **Step 3: Implement the layout**

Replace the four large summary cards with compact filter buttons; add the price subline and judgment column; move the best candidate to its own prominent strip; allow a two-line product title and make the product column flexible.

- [x] **Step 4: Run test to verify it passes**

Run: `node test-results-page.mjs`
Expected: PASS for the new layout contract.

### Task 3: 时间、状态、响应式与最终验证

**Files:**
- Modify: `test-results-page.mjs`
- Modify: `results-page.mjs`

**Interfaces:**
- Produces: `formatJstShort(value): { short: string, full: string }`
- Updates: one-shot `renderMonitorStatus(status)` copy without adding timers

- [x] **Step 1: Write the failing time and status assertions**

```js
assert.deepEqual(formatJstShort('2026-08-12T03:00:00.000Z'), {
  short: '08-12 12:00',
  full: '2026/08/12 12:00',
});
assert.match(rendered, /后台正常｜上次检查/);
assert.match(rendered, /@media \(max-width: 920px\)/);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node test-results-page.mjs`
Expected: FAIL because short timestamps and the new status copy are absent.

- [x] **Step 3: Implement time, copy, accessibility and responsive rules**

Use compact visible JST timestamps with full titles, raise utility text to 12px, strengthen active sort styling, remove the pulsing status animation, and hide lower-priority columns at narrow widths.

- [x] **Step 4: Run focused and full verification**

Run: `node test-results-page.mjs`

Run: `npm test`

Run: `npm run check`

Expected: all commands exit 0 with no failures.

- [x] **Step 5: Generate and inspect the page**

Run the existing result-page generation path against local data, capture desktop and narrow viewport screenshots, and verify that the best candidate, budget filter, decision column, conflict warning, and responsive hiding are legible.
