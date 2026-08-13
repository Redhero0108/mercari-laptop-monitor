# Five Business Series Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit Mercari laptop monitoring and displayed results to ThinkPad X1 Carbon, HP ProBook, Dell Precision, Panasonic Let's note, and Dynabook G83 while preserving the current hardware, CPU, condition, price, availability, and JUNK exclusions.

**Architecture:** Add a focused laptop-series and hard-filter module that normalizes the five supported series and explains rejection reasons. Reuse it in scoring and every monitor ingestion/refresh path, store eligibility facts with each result, and filter legacy results when regenerating the page. Keep the existing global CLI as the only keyword write path and atomically replace the five capacity searches with five series-plus-32GB searches.

**Tech Stack:** Node.js ES modules, built-in `node:assert`, PowerShell, global `mercari-watch` CLI.

## Global Constraints

- Runtime remains Windows 10 and PowerShell compatible.
- Allowed series are exactly ThinkPad X1 Carbon, HP ProBook, Dell Precision, Panasonic Let's note, and Dynabook G83.
- Keep 32GB RAM, SSD capacity of at least 512GB, Intel generation 12 or newer, condition levels 1-3, price ceiling, JUNK exclusion, and on-sale checks.
- Do not purchase products or contact sellers.
- Do not commit unless the user separately requests it.

---

### Task 1: Series recognition and hard eligibility

**Files:**
- Create: `laptop-filters.mjs`
- Create: `test-laptop-filters.mjs`
- Modify: `scoring.mjs`
- Modify: `test-scoring.mjs`

**Interfaces:**
- Produces: `DEFAULT_ALLOWED_SERIES`, `detectLaptopSeries(text)`, `isAllowedLaptopSeries(text, allowedSeries)`, `hardFilterFailure(assessment)`, and `resultMatchesHardFilters(entry, allowedSeries)`.
- Produces: `assessment.series`, `assessment.seriesEligible`, and existing hardware facts for monitor persistence.

- [ ] **Step 1: Write failing tests for the five series, rejected non-target series, and missing hardware.**

  Use literal titles for all five supported families plus HP EliteBook as a negative example. Assert that an otherwise eligible EliteBook is not alertable when `allowedSeries` is configured.

- [ ] **Step 2: Run the focused tests and verify failure because the new module and fields do not exist.**

  Run: `node test-laptop-filters.mjs`

- [ ] **Step 3: Implement the minimal normalizer and connect it to scoring.**

  Return stable series IDs and labels, support Japanese `レッツノート` plus common `CF-*` model notation, and keep scoring unrestricted only when `allowedSeries` is absent.

- [ ] **Step 4: Run focused scoring/filter tests and verify they pass.**

  Run: `node test-laptop-filters.mjs; node test-scoring.mjs`

### Task 2: Enforce the rules throughout the monitor

**Files:**
- Modify: `monitor.mjs`
- Modify: `config.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the filter functions and assessment fields from Task 1.
- Produces: strict filtering on initial scans, metadata refreshes, live refreshes, and legacy-result page regeneration.

- [ ] **Step 1: Add monitor-facing assertions to `test-laptop-filters.mjs` for persisted legacy and current result shapes.**

- [ ] **Step 2: Run the focused test and verify the legacy result case fails.**

  Run: `node test-laptop-filters.mjs`

- [ ] **Step 3: Apply the hard filter after CPU and condition checks in every ingestion path.**

  Persist `has32GB`, `has512GB`, `hasSSD`, `seriesId`, `seriesLabel`, and `seriesEligible`; regenerate results using the same filter so old non-target rows disappear.

- [ ] **Step 4: Set `allowedSeries` to the five stable IDs and document the restriction.**

- [ ] **Step 5: Run focused tests and syntax checks.**

  Run: `npm run check; node test-laptop-filters.mjs; node test-scoring.mjs`

### Task 3: Replace the five monitoring tasks through `mercari-watch`

**Files:**
- Modify through CLI: `config.json` (`queries` only)

**Interfaces:**
- Consumes: `mercari-watch keywords replace-all`.
- Produces: five enabled tasks using each allowed series name plus `32GB`.

- [ ] **Step 1: Dry-run an atomic replacement with the five series searches.**

  Use `X1 Carbon 32GB`, `HP ProBook 32GB`, `Dell Precision 32GB`, `レッツノート 32GB`, and `dynabook G83 32GB`. The shorter X1 query is required because many legitimate Mercari titles omit the `ThinkPad` word.

- [ ] **Step 2: Apply the same replacement with `--yes`.**

- [ ] **Step 3: Verify tasks and configuration through stable JSON output.**

  Run: `mercari-watch --json tasks list; mercari-watch --json config show`

- [ ] **Step 4: Run the full offline test suite and inspect the final diff.**

  Run: `npm test; npm run check; git diff --check; git status --short`
