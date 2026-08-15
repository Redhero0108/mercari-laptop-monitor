# Strict Risk and Memory Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底剔除标题仅为 16GB/可升级 32GB，以及存在外观屏幕缺陷、严重故障或锁机风险的商品。

**Architecture:** 在 `laptop-filters.mjs` 中集中实现纯标题判断和风险判断，并让新商品写入前的 `hardFilterFailure` 与已有结果的 `resultMatchesHardFilters` 共用这些规则。`monitor.mjs` 只负责把商品标题传入中央过滤器并展示明确的剔除日志。

**Tech Stack:** Node.js ESM、内置 `node:assert/strict`、PowerShell、现有 Mercari monitor。

## Global Constraints

- 保留明确 `32GB`、`16GB×2`、`16GBx2`、`16GB*2`、`16GB+16GB` 的商品。
- 剔除单独 `16GB` 或当前 16GB 但描述可升级到 32GB 的商品。
- 剔除理由含“外观或屏幕有缺陷”或“严重故障/锁机风险”的商品。
- 不增加依赖、后台进程或检查频率；继续保持单进程和 10 分钟周期。

---

### Task 1: 中央硬过滤规则

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`

**Interfaces:**
- Produces: `titleHasDisallowed16GB(title: string): boolean`
- Extends: `hardFilterFailure(assessment, maxResultPriceYen, title): null | 'series' | 'memory' | 'storage' | 'ssd' | 'price' | 'risk'`
- Extends: `resultMatchesHardFilters(entry, allowedSeries, maxResultPriceYen): boolean`

- [ ] **Step 1: Write failing tests for title memory and risk rejection**

Add assertions proving that plain 16GB and upgradeable 16GB are rejected, explicit 32GB and two 16GB modules pass, and both risk reasons are rejected by the assessment and persisted-result paths.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node .\test-laptop-filters.mjs`

Expected: FAIL because the new title helper and strict rejection behavior do not exist.

- [ ] **Step 3: Implement the minimal centralized rules**

Normalize titles with the existing `compact` helper. Detect explicit total 32GB before treating a standalone 16GB token as disallowed. Add a risk-reason predicate and reuse both predicates from `hardFilterFailure` and `resultMatchesHardFilters`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node .\test-laptop-filters.mjs`

Expected: `laptop filter tests: OK`.

### Task 2: Monitor integration and live cleanup

**Files:**
- Modify: `monitor.mjs`
- Test: `test-laptop-filters.mjs`

**Interfaces:**
- Consumes: `hardFilterFailure(assessment, maxResultPriceYen, title)`
- Produces: one consistent rejection decision for metadata refresh, live refresh and new search results.

- [ ] **Step 1: Pass each item title into the hard-filter decision**

Change `hardFilterMessage` to accept `title`, add a `risk` log message, and pass `detailed.title` or `item.title` at all three call sites before any result is recorded or alerted.

- [ ] **Step 2: Run full automated verification**

Run: `npm test`

Expected: all suites print `OK` and exit 0.

Run: `npm run check`

Expected: all `node --check` commands exit 0.

- [ ] **Step 3: Apply the rule to current results without adding a persistent process**

Run one bounded `mercari-watch --json check`, then verify that `results.json` contains no disallowed title or risk reason and that exactly one persistent `monitor.mjs` process remains.

- [ ] **Step 4: Commit the implementation**

```powershell
git add -- laptop-filters.mjs test-laptop-filters.mjs monitor.mjs
git commit -m "feat: 剔除低内存与高风险商品"
```
