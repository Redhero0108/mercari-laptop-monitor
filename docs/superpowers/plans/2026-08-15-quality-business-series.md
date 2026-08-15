# Quality-First Business Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six quality-filtered business laptop series, lower the alert ceiling to ¥70,000, and safely recheck listings skipped only by the old series allowlist.

**Architecture:** Extend the centralized series detector with precise product-line rules and keep all allowlist consumers using its stable IDs. Add a pure state-migration helper that restores only newly allowed series rejections, then call it before scanning. Keep the independent ¥99,999 result ceiling unchanged while aligning all alert-price defaults to ¥70,000.

**Tech Stack:** Node.js ES modules, JSON configuration, Windows PowerShell launch scripts, Node built-in assertions.

## Global Constraints

- Keep the original five allowed series.
- Add only LIFEBOOK U7412, quality-tier VersaPro, ExpertBook B9, VAIO Pro, Latitude 5000/7000/9000, and EliteBook.
- Generic VersaPro, Latitude 3000, generic VAIO, non-U7412 LIFEBOOK, and non-B9 ExpertBook remain excluded.
- Alert ceiling is exactly `70000`; result ceiling remains exactly `99999`.
- Restore only history entries rejected by the old series rule and now accepted by the new detector.
- Do not add dependencies or alter CPU, memory, storage, condition, notification, or ten-minute scheduling rules.

---

### Task 1: Add precise series recognition

**Files:**
- Modify: `test-laptop-filters.mjs`
- Modify: `laptop-filters.mjs`
- Modify: `test-scoring.mjs`
- Modify: `scoring.mjs`

**Interfaces:**
- Consumes: `detectLaptopSeries(text)` and `DEFAULT_ALLOWED_SERIES`.
- Produces: six stable IDs: `fujitsu-lifebook-u7412`, `nec-versapro-premium`, `asus-expertbook-b9`, `vaio-pro`, `dell-latitude-premium`, `hp-elitebook`.

- [ ] **Step 1: Write failing positive and negative detector tests**

Add positive titles for the six IDs and negative assertions for `LIFEBOOK U9312`, generic `NEC VersaPro`, `ExpertBook B5`, `VAIO SX12`, and `Latitude 3420`. Include positive VersaPro titles containing `UltraLite` or `タイプVN`, and Latitude models 5350, 7450, and 9450.

- [ ] **Step 2: Run the detector test and confirm RED**

Run `node .\test-laptop-filters.mjs`.

Expected: the first new positive case has no detected ID.

- [ ] **Step 3: Add minimal regex rules**

Add rules before generic consumers in `SERIES_RULES`:

```js
{ id: 'fujitsu-lifebook-u7412', label: 'Fujitsu LIFEBOOK U7412', pattern: /\blife\s*book\s*u7412\b/i }
{ id: 'nec-versapro-premium', label: 'NEC VersaPro Premium Mobile', pattern: /^(?=.*\bversapro\b)(?=.*(?:ultra\s*lite|タイプ\s*v(?:n|g|h|m)\b))/i }
{ id: 'asus-expertbook-b9', label: 'ASUS ExpertBook B9', pattern: /\bexpert\s*book\s*b9(?:\d{3})?\b/i }
{ id: 'vaio-pro', label: 'VAIO Pro', pattern: /\bvaio\s*pro\b/i }
{ id: 'dell-latitude-premium', label: 'Dell Latitude 5000/7000/9000', pattern: /\blatitude\s*(?:5|7|9)\d{3}\b/i }
{ id: 'hp-elitebook', label: 'HP EliteBook', pattern: /(?:\bhp\s+)?\belite\s*book\b/i }
```

- [ ] **Step 4: Extend scoring coverage and business-model recognition**

Append the six IDs to the scoring test allowlist, verify every accepted title can alert at ¥60,000, and add `expertbook\s*b9` plus the accepted VersaPro forms to `BUSINESS_MODELS`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run `node .\test-laptop-filters.mjs` and `node .\test-scoring.mjs`.

Expected: both print `OK` and exit 0.

### Task 2: Migrate only newly allowed historical skips

**Files:**
- Create: `state-migrations.mjs`
- Create: `test-state-migrations.mjs`
- Modify: `monitor.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `isAllowedLaptopSeries(title, allowedSeries)`.
- Produces: `restoreNewlyAllowedSeriesSkips(state, allowedSeries) -> string[]`, returning restored item IDs while mutating only `state.seen`.

- [ ] **Step 1: Write the failing migration test**

Create a state fixture containing: an old series rejection now accepted, an old series rejection still disallowed, a storage rejection, and a normal seen item. Assert that only the newly accepted series ID is removed and returned.

- [ ] **Step 2: Run the migration test and confirm RED**

Run `node .\test-state-migrations.mjs`.

Expected: module-not-found for `state-migrations.mjs`.

- [ ] **Step 3: Implement the pure migration helper**

Recognize the historical messages `不在指定五个商务系列中` and `非指定商务系列`. For each matching entry, delete it only if its current title is allowed. Return deleted IDs without touching `initialized` or unrelated entries.

- [ ] **Step 4: Integrate migration before monitor scanning**

Import the helper in `monitor.mjs`. After logging is available but before PID claim and page generation, call it; when IDs are returned, call `saveState()` once and log `已恢复 N 件因旧系列规则跳过的商品，等待重新检查。` Change the live hard-filter message to `不在指定品质商务系列中`.

- [ ] **Step 5: Register and run the test**

Add `node test-state-migrations.mjs` to `npm test`, add `node --check state-migrations.mjs` to `npm run check`, then run the focused test and syntax checks for both `state-migrations.mjs` and `monitor.mjs`.

Expected: migration test prints `OK`; syntax check exits 0.

### Task 3: Lower only the alert ceiling

**Files:**
- Modify: `config.json`
- Modify: `monitor.mjs`
- Modify: `scoring.mjs`
- Modify: `results-page.mjs`
- Modify: `test-scoring.mjs`
- Modify: `test-results-page.mjs`
- Modify: `test-runtime-intervals.mjs`

**Interfaces:**
- Consumes: `config.maxPriceYen` for alert decisions and `config.maxResultPriceYen` for result retention.
- Produces: alert threshold `70000`, unchanged result retention threshold `99999`.

- [ ] **Step 1: Write failing price-boundary tests**

Assert a fully qualified ¥70,000 item alerts, a ¥70,001 item does not alert, `primaryBlocker()` reports `超预算 ¥1`, and runtime configuration is `maxPriceYen === 70000` plus `maxResultPriceYen === 99999`.

- [ ] **Step 2: Run price tests and confirm RED**

Run `node .\test-scoring.mjs`, `node .\test-results-page.mjs`, and `node .\test-runtime-intervals.mjs`.

Expected: at least the ¥70,001 alert or configuration assertion fails under the old ¥95,000 threshold.

- [ ] **Step 3: Align configured and fallback alert ceilings**

Set `config.json.maxPriceYen`, `monitor.mjs` default, `scoring.mjs` fallback, and `results-page.mjs` fallback to `70000`. Leave every `maxResultPriceYen` value at `99999`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the three price-related test files again.

Expected: all print `OK` and exit 0.

### Task 4: Document, verify, commit, and activate

**Files:**
- Modify: `README.md`
- Runtime-only: `state.json`, `results.json`, `results.html`, `monitor.pid`, `monitor-status.js`, `monitor.log`

**Interfaces:**
- Consumes: project test scripts and project-specific background start/stop scripts.
- Produces: committed implementation and one running ten-minute monitor using the new filters.

- [ ] **Step 1: Update README**

List all eleven allowed series with the strict Latitude and VersaPro qualification, document ¥70,000 alert versus ¥99,999 result ceilings, and remove references to “five series” or ¥95,000.

- [ ] **Step 2: Run complete verification**

Run `npm test`, `npm run check`, `git diff --check`, and CLI `doctor` plus `config show`.

Expected: all tests and syntax checks pass; doctor reports `ready: true`; configuration reports `70000`, `99999`, and all eleven allowed IDs.

- [ ] **Step 3: Commit implementation**

Commit source, tests, config, and README with `feat: 扩展品质商务本筛选`.

- [ ] **Step 4: Activate without touching unrelated processes**

Use `monitor.pid` and `stop-background.ps1` to stop only the project monitor. Start a bounded `mercari-watch --json check` to apply the targeted migration and recheck restored items, then restart `start-background.ps1`.

- [ ] **Step 5: Verify runtime output**

Confirm the log reports the restored count, the new hidden monitor reaches `运行中 / 等待下一轮检查`, generated results retain no item priced ¥100,000 or more, and no disallowed negative-series fixture can pass the detector.

- [ ] **Step 6: Verify final repository state**

Run `git status --short`, `git log -4 --oneline`, and a fresh `npm test` plus `npm run check` before reporting completion.
