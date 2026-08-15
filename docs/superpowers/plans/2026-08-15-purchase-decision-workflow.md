# Purchase Decision Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded price/like history, confidence-aware ranking, series and triage filters, expandable details, recommendation help, and 24-hour change markers to the existing static results page.

**Architecture:** A new pure `result-history.mjs` module owns bounded observation history. `monitor.mjs` enriches existing result records without changing its requests or intervals. `results-page.mjs` derives confidence, trends and ranking, then renders a self-contained HTML interface whose personal triage state remains in `localStorage`.

**Tech Stack:** Node.js ES modules, built-in `node:assert/strict`, static HTML/CSS/JavaScript, PowerShell launch scripts, Playwright CLI for final browser verification.

## Global Constraints

- Backend and page refresh remain every 10 minutes; add no polling, browser pages, or Mercari requests.
- Add no third-party dependency, database, or resident process.
- Keep at most 12 distinct observations for price and likes per product.
- Keep personal triage only in browser `localStorage`.
- Preserve the current restrained cream, gold-brown and green interface.

---

### Task 1: Bounded result history

**Files:**
- Create: `result-history.mjs`
- Create: `test-result-history.mjs`
- Modify: `monitor.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `mergeResultHistory(previous, current, observedAt, baseline)` returning `current` plus `firstSeenAt`, `priceHistory`, and `likeHistory`.
- Consumes: `baseline = { firstSeenAt, price }` from `state.seen[item.id]` when available.

- [ ] **Step 1: Write failing history tests**

```js
assert.deepEqual(
  mergeResultHistory(null, { price: 70000, likeCount: 2 }, '2026-08-15T00:00:00Z', {}),
  {
    price: 70000,
    likeCount: 2,
    firstSeenAt: '2026-08-15T00:00:00Z',
    priceHistory: [{ value: 70000, at: '2026-08-15T00:00:00Z' }],
    likeHistory: [{ value: 2, at: '2026-08-15T00:00:00Z' }],
  },
);
```

Also assert that identical values do not append, changed values do append, legacy baseline price is retained, invalid values are ignored, and 13 changes retain only the newest 12.

- [ ] **Step 2: Run test and verify RED**

Run: `node test-result-history.mjs`

Expected: failure because `result-history.mjs` does not exist.

- [ ] **Step 3: Implement minimal history merger**

Normalize existing arrays to finite `{ value, at }` entries, seed legacy values, append only when the last distinct value differs, and slice to `-12`.

- [ ] **Step 4: Run history test and verify GREEN**

Run: `node test-result-history.mjs`

Expected: `result history tests: OK`.

- [ ] **Step 5: Integrate monitor writes**

Import `mergeResultHistory` in `monitor.mjs`. Build each current result object first, then assign:

```js
results[item.id] = mergeResultHistory(previous, current, now, {
  firstSeenAt: state.seen[item.id]?.seenAt,
  price: state.seen[item.id]?.price,
});
```

Use the same path in `recordResult` and `recordLiveResult`. Add `test-result-history.mjs` and `result-history.mjs` to `npm test` / `npm run check`.

- [ ] **Step 6: Verify Task 1**

Run: `npm test && npm run check`

Expected: all suites and syntax checks pass.

### Task 2: Confidence, trends, changes, and one ranking rule

**Files:**
- Modify: `results-page.mjs`
- Modify: `test-results-page.mjs`
- Modify: `monitor.mjs`

**Interfaces:**
- Produces: `storageSpecConflict(entry)`, `specConfidence(entry)`, `priceTrend(entry)`, `recentChangeBadges(entry, nowMs)`, and `compareRecommendedEntries(left, right)`.
- Changes: `isDisplayQualified` and `primaryBlocker` treat memory or storage conflicts as a warning; monitor output and best candidate use `compareRecommendedEntries`.

- [ ] **Step 1: Write failing derivation tests**

Use literal fixtures to assert:

```js
assert.deepEqual(
  storageSpecConflict({ title: '32GB SSD512GB', reasons: ['1TB存储'] }),
  { conflict: true, label: '标题512GB / 检测1TB · 需要人工确认' },
);
assert.equal(specConfidence(confirmedTitle).label, '标题确认');
assert.equal(priceTrend(changedPrice).delta, -5000);
assert.deepEqual(recentChangeBadges(changedEntry, nowMs).map((x) => x.label), ['新发现', '降价', '收藏 +2']);
```

Assert ranking order using three literal entries with different alert, score and price values.

- [ ] **Step 2: Run test and verify RED**

Run: `node test-results-page.mjs`

Expected: failure because the new exported helpers are missing.

- [ ] **Step 3: Implement pure helpers and safety behavior**

Detect explicit title memory/storage values after NFKC normalization. Derive confidence without making network calls. Compute the latest two distinct history points and only emit change badges whose latest point is within 24 hours. Implement the exact comparator from the design.

- [ ] **Step 4: Run test and verify GREEN**

Run: `node test-results-page.mjs`

Expected: `results page tests: OK`.

- [ ] **Step 5: Use the comparator in monitor output**

Import `compareRecommendedEntries` next to `renderResultsPage`, replace the old alert/time sort, and use the same comparator for `bestEntry`.

- [ ] **Step 6: Verify Task 2**

Run: `npm test && npm run check`

Expected: all suites and syntax checks pass.

### Task 3: Decision workflow interface

**Files:**
- Modify: `results-page.mjs`
- Modify: `test-results-page.mjs`

**Interfaces:**
- Extends: `matchesResultRow(dataset, filter, query, options)` with `series` and `triage` conditions.
- Produces rendered controls `#series-filter`, `#triage-filter`, `.detail-toggle`, `.product-details`, `.triage-button`, `.change-badge`, and `.recommendation-help`.

- [ ] **Step 1: Write failing filter and render tests**

Assert real behavior for combined search, quick filter, series, and triage:

```js
assert.equal(matchesResultRow(
  { match: '1', changed: '1', grade: '3', search: 'elitebook', series: 'hp-elitebook', triage: 'watch' },
  'changed',
  'EliteBook',
  { series: 'hp-elitebook', triage: 'watch' },
), true);
```

Render fixtures containing history and series fields. Assert controls, expanded detail content, 24-hour badges, trend text, recommendation help, `aria-expanded`, `aria-pressed`, escaped dynamic text, reduced-motion CSS, and valid inline JavaScript.

- [ ] **Step 2: Run test and verify RED**

Run: `node test-results-page.mjs`

Expected: first missing selector or changed-filter assertion fails.

- [ ] **Step 3: Implement compact controls and row content**

Generate unique series options from current entries. Replace the `24H 新上架` quick filter with `24H 有变化`. Add price trend and change badges. Keep details inside the product cell so DOM sorting remains stable.

- [ ] **Step 4: Implement local triage and details interaction**

Use keys:

```js
const triageStorageKey = 'mercari-laptop-monitor-triage-v1';
const seriesStorageKey = 'mercari-laptop-monitor-series';
const triageFilterStorageKey = 'mercari-laptop-monitor-triage-filter';
```

Default new rows to `unseen`; opening a product changes only `unseen` to `seen`; triage buttons set `unseen`, `watch`, or `ignored`. The default `active` filter excludes ignored rows. Re-run visibility after every state change and retain search/sort/filter state.

- [ ] **Step 5: Apply restrained CSS and accessible motion**

Add one wrapping control bar, quiet text badges, an inset detail area, visible focus styles, and 160ms transitions. Add:

```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
```

- [ ] **Step 6: Run focused and full tests**

Run: `node test-results-page.mjs && npm test && npm run check`

Expected: all suites and syntax checks pass.

### Task 4: Live generation and browser acceptance

**Files:**
- Generated, not committed: `results.html`, `results.json`
- Modify only if a failing acceptance check exposes a tested defect: related source and test file.

**Interfaces:**
- Consumes: existing `stop-background.ps1`, `start-background.ps1`, and `open-results.cmd` workflow.
- Produces: one live static page generated by the single existing monitor process.

- [ ] **Step 1: Restart the existing monitor once**

Run the existing stop and start scripts, then confirm `monitor.pid` points to one responding Node process and `results.html` has a new timestamp.

- [ ] **Step 2: Browser acceptance**

Serve the workspace only for the test session. In Playwright verify:

- series filter narrows results;
- details opens and updates `aria-expanded`;
- setting ignored hides the row under `active` and reappears under `ignored`;
- state survives reload;
- recommendation help and change markers render;
- seven columns remain aligned at 1440px and the 820px layout remains usable.

- [ ] **Step 3: Stop all temporary verification resources**

Close the Playwright browser and stop the temporary HTTP server. Keep only the intended monitor Node process.

- [ ] **Step 4: Final verification and commit**

Run: `git diff --check && npm test && npm run check`

Review `git status`, stage only planned source/tests/docs, commit, then confirm a clean worktree and the latest commit.
