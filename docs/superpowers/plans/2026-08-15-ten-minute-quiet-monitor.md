# Ten-Minute Quiet Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `open-results.cmd` launch the hidden monitor and results page while all Mercari checks and page reloads run at ten-minute intervals without high-frequency status polling or heartbeat writes.

**Architecture:** Keep the existing idempotent hidden PowerShell launcher and static HTML results page. Change the shared runtime configuration to ten minutes, render a 600-second page reload, load monitor status only once per page load, and remove the monitor's standalone heartbeat timer so the process is idle between scheduled checks.

**Tech Stack:** Node.js ES modules, static HTML/CSS/JavaScript, Windows PowerShell 5.1, CMD, Node built-in test assertions.

## Global Constraints

- Windows and PowerShell remain the supported runtime.
- No new dependencies and no changes to product filters, notification rules, or stored result formats.
- Search, live-product refresh, and page reload intervals must all be exactly 10 minutes.
- `open-results.cmd` must remain a single double-click entry point and must not create duplicate monitors.
- The page must not perform a 10-second status poll, and the monitor must not write heartbeat files while waiting.

---

### Task 1: Lock the ten-minute behavior with failing tests

**Files:**
- Create: `test-runtime-intervals.mjs`
- Modify: `test-results-page.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `renderResultsPage(entries, config, options)` from `results-page.mjs`.
- Produces: regression coverage for page reload markup, status polling removal, runtime configuration, and heartbeat timer removal.

- [ ] **Step 1: Write the failing page-rendering assertions**

Add assertions after `rendered` is created:

```js
assert.match(rendered, /<meta http-equiv="refresh" content="600">/);
assert.match(rendered, /页面每10分钟刷新/);
assert.match(rendered, /refreshMonitorStatus\(\);/);
assert.doesNotMatch(rendered, /setInterval\(refreshMonitorStatus/);
```

- [ ] **Step 2: Create the runtime interval regression test**

Create `test-runtime-intervals.mjs` that reads `config.json` and `monitor.mjs`, asserts `pollMinutes === 10`, `likesRefreshMinutes === 10`, verifies the monitor default and fallback are 10, and rejects `setInterval` inside `startHeartbeat`.

- [ ] **Step 3: Register and run the focused tests to verify failure**

Add `node test-runtime-intervals.mjs` to the `test` script, then run:

```powershell
node .\test-results-page.mjs
node .\test-runtime-intervals.mjs
```

Expected: at least the 600-second page refresh assertion and `pollMinutes === 10` assertion fail against the existing implementation.

### Task 2: Implement quiet ten-minute scheduling

**Files:**
- Modify: `config.json`
- Modify: `monitor.mjs`
- Modify: `results-page.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `config.pollMinutes`, `config.likesRefreshMinutes`, `setMonitorPhase()`, and page renderer.
- Produces: ten-minute search/live refresh scheduling and a page that reloads and reads status once every ten minutes.

- [ ] **Step 1: Update runtime intervals**

Set `config.json` `pollMinutes` to `10`. In `monitor.mjs`, change the default and invalid-value fallback for `pollMinutes` from `5` to `10` while retaining the existing minimum validation.

- [ ] **Step 2: Remove the monitor heartbeat timer**

Delete `heartbeatTimer`, `startHeartbeat()`, and its invocation. Keep status writes in `setMonitorPhase()` and make `stopHeartbeat()` only write the stopped state so shutdown behavior remains compatible.

- [ ] **Step 3: Update the generated page**

Change the meta refresh to `600`, update the hint to say both page and backend refresh every ten minutes, change the stale-status threshold to 15 minutes, keep the single `refreshMonitorStatus()` call, and remove its `setInterval` call.

- [ ] **Step 4: Update operating documentation**

Change README references from five-minute search/page refresh to ten minutes, document that the status file is read once per page load, and explain that the hidden process stays idle between checks.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
node .\test-results-page.mjs
node .\test-runtime-intervals.mjs
node .\test-powershell.mjs
```

Expected: all three commands print their `OK` messages and exit 0.

Commit the implementation and tests together with message `feat: 十分钟静默刷新监控`.

### Task 3: Verify the generated artifact and restart the hidden monitor

**Files:**
- Runtime-only: `results.html`, `monitor.pid`, `monitor-status.js`, `monitor.log`

**Interfaces:**
- Consumes: `stop-background.ps1`, `start-background.ps1`, and the updated renderer.
- Produces: one running monitor using the new ten-minute settings and a freshly generated results page.

- [ ] **Step 1: Run the complete verification suite**

```powershell
npm test
npm run check
```

Expected: all tests pass and every listed JavaScript file passes syntax checking.

- [ ] **Step 2: Restart only the project monitor**

Run `stop-background.ps1`, verify the PID recorded by this project is no longer active, then run `start-background.ps1`. Do not stop unrelated Node or PowerShell processes.

- [ ] **Step 3: Verify the runtime output**

Wait only for the initial page generation, then assert that `results.html` contains `content="600"`, does not contain `setInterval(refreshMonitorStatus`, and that `monitor-status.js` records one active PID. Confirm `monitor.log` reports ten-minute search and live-data refresh intervals.

- [ ] **Step 4: Check repository scope**

Run `git status --short` and `git diff --check`. Only the intended source, test, README, and plan files may be changed; runtime artifacts remain ignored.
