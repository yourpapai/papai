<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement & Test-Quality Investigation — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one well-organized findings report that proves/disproves why 77.2% of mutants are discarded as "static," and assesses the quality of the suite's preloads, mocking, and DI — making **no changes to `src/` or `tests/`** and no committed config changes.

**Architecture:** A read-only investigation. Evidence comes from (a) analysis of the existing `reports/mutation.json`, (b) reading the pinned `@hughescr/stryker-bun-runner` source to establish the exact static-vs-perTest bucketing mechanism, (c) scoped Stryker runs driven by **ephemeral `/tmp` throwaway configs** that vary one factor at a time, and (d) static analysis (grep) of the test suite. Each task appends a section to the findings report and commits it.

**Tech Stack:** Bun test runner, StrykerJS 9.6 + `@hughescr/stryker-bun-runner` 1.2.2 + `@stryker-mutator/typescript-checker`, Node for JSON analysis, ripgrep/grep for static analysis.

---

## Spec

Source spec: `docs/superpowers/specs/2026-05-24-mutation-measurement-test-quality-investigation.md`.

## Hard Constraints (apply to EVERY task)

- **Never** edit any file under `src/` or `tests/`, and **never** commit changes to `stryker.config.json`, `bunfig.toml`, `tsconfig.json`, or `package.json`. These are reference inputs only.
- All Stryker experiments use a throwaway config written to `/tmp/` (e.g. `/tmp/stryker.exp.json`). Stryker takes the config path as a **positional** argument: `bunx stryker run /tmp/stryker.exp.json`.
- The **only** file this plan creates or modifies in the repo is the findings report: `docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`.
- `ignoreStatic: true` is **incompatible** with `coverageAnalysis: "off"` / `"all"`. To run with `ignoreStatic: false` you must keep `coverageAnalysis: "perTest"`.
- Long Stryker runs must be launched with `run_in_background: true` and polled via an `until`-loop; do not chain `sleep`.
- Before each commit of the report, run `bun format` (oxfmt reformats Markdown tables) so the Stop hook's `format:check` and `license-headers` pass.

## Findings Report Section Map

The report is built incrementally. Final structure:

1. Executive Summary
2. Track A — Measurement Root Cause (A1 baseline, A2 mechanism, A3 reproduction, A4 concurrency, A5 preload isolation, A6 true-score probe)
3. Track B — Test-Infrastructure Quality (B1 preloads, B2 mock.module blast radius, B3 DI adherence, B4 test-quality signals, B5 interaction)
4. Track C — Synthesis & Deferred Options (C1 root cause, C2 quality assessment, C3 deferred options)
5. Appendix — Commands & Raw Outputs

---

## Task 0: Scaffold the findings report

**Files:**

- Create: `docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md`

- [ ] **Step 1: Write the report skeleton**

Create the file with this exact content:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Measurement & Test-Quality — Findings

**Date:** 2026-05-24
**Type:** Investigation / research only — no `src/` or `tests/` changes were made.
**Spec:** `docs/superpowers/specs/2026-05-24-mutation-measurement-test-quality-investigation.md`

## 1. Executive Summary

_(filled last — headline numbers and the one-line root cause)_

## 2. Track A — Measurement Root Cause

### A1. Baseline status breakdown

### A2. Runner bucketing mechanism (static vs perTest)

### A3. Scoped reproduction (single well-tested file)

### A4. Variable test — concurrency

### A5. Variable test — preload isolation

### A6. True-score probe (ignoreStatic:false, scoped)

## 3. Track B — Test-Infrastructure Quality

### B1. Preload architecture

### B2. mock.module() blast radius

### B3. DI adherence

### B4. Test-quality signals from mutation data

### B5. Interaction with mutation measurement

## 4. Track C — Synthesis & Deferred Options

### C1. Root-cause statement

### C2. Quality assessment

### C3. Options for a future effort (deferred — not executed)

## 5. Appendix — Commands & Raw Outputs
```

- [ ] **Step 2: Verify it passes format and license checks**

Run: `bun format && bun format:check && bun license:headers`
Expected: `All matched files use the correct format.` and `Done: 0 stamped, N skipped` (the report is already stamped).

- [ ] **Step 3: Commit**

```bash
git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): scaffold mutation measurement findings report"
```

---

## Task 1 (A1): Baseline status breakdown

**Files:**

- Modify: findings report → section `### A1. Baseline status breakdown`

- [ ] **Step 1: Compute the status breakdown from the existing report**

Run:

```bash
node -e '
const r=require("./reports/mutation.json");
let c={},total=0;
for(const f of Object.values(r.files||{}))for(const m of f.mutants){total++;c[m.status]=(c[m.status]||0)+1;}
const valid=(c.Killed||0)+(c.Survived||0)+(c.NoCoverage||0)+(c.Timeout||0);
console.log("total",total);console.log(JSON.stringify(c,null,2));
console.log("valid",valid,"score",(100*((c.Killed||0)+(c.Timeout||0))/valid).toFixed(2)+"%");
console.log("ignored%",(100*(c.Ignored||0)/total).toFixed(1));
'
```

Expected (current data): `total 10410`, `Ignored 8032`, `CompileError 704`, `NoCoverage 667`, `Survived 613`, `Killed 392`, `Timeout 2`, `valid 1674`, `score 23.54%`, `ignored% 77.2`.

- [ ] **Step 2: Record into A1**

Paste the status table (Status | Count | % of total), the score-math line `(392+2)/1674 = 23.54%`, and one sentence: "77.2% of instrumented mutants are excluded as static before scoring." If the live numbers differ from the above, record the live numbers and note the discrepancy.

- [ ] **Step 3: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A1 baseline mutant status breakdown"
```

---

## Task 2 (A2): Establish the runner's bucketing mechanism from source

**Files:**

- Read-only: `node_modules/@hughescr/stryker-bun-runner/dist/index.js`, `dist/coverage/preload-logic.js`, `dist/templates/coverage-preload.ts`, `README.md`
- Modify: findings report → section `### A2. Runner bucketing mechanism (static vs perTest)`

- [ ] **Step 1: Read how coverage is bucketed and how a testId is assigned**

Run:

```bash
sed -n '1,200p' node_modules/@hughescr/stryker-bun-runner/dist/coverage/preload-logic.js
grep -n "perTest\|static\|testId\|beforeEach\|currentTest\|activeMutant\|mutantCoverage" node_modules/@hughescr/stryker-bun-runner/dist/index.js
sed -n '1,120p' node_modules/@hughescr/stryker-bun-runner/dist/templates/coverage-preload.ts
```

Expected: code showing `mutantCoverage = { static: {}, perTest: {} }`, a hook (e.g. `beforeEach`) that sets the current test id, and the rule that coverage recorded with no active test id goes to the `static` bucket.

- [ ] **Step 2: Determine the precise static-classification rule**

Answer, with line citations: (1) When is a mutant's coverage attributed to `perTest[testId]` vs `static`? (2) What sets/clears the active test id, and via which hook? (3) Does the runner force `bun test --concurrency=1`, and where?

- [ ] **Step 3: Record into A2**

Write the mechanism as a short numbered description with `file:line` citations and a one-paragraph plain-English summary: "A mutant becomes static when … which `ignoreStatic:true` then drops." State which of the spec's four hypotheses this mechanism makes plausible and which it rules out a priori.

- [ ] **Step 4: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A2 runner static-vs-perTest bucketing mechanism"
```

---

## Task 3 (A3): Reproduce the static collapse on one well-tested file

**Files:**

- Read-only reference: `tests/providers/kaneo/column-resource.test.ts` (proven to execute real `list()`)
- Ephemeral: `/tmp/stryker.A3.json`
- Modify: findings report → section `### A3. Scoped reproduction (single well-tested file)`

- [ ] **Step 1: Confirm the file's `list()` is really executed by bun**

Run: `bun test tests/providers/kaneo/column-resource.test.ts --coverage 2>&1 | grep -i "column-resource"`
Expected: a coverage line showing `column-resource.ts` with non-zero `% Lines` (e.g. ~21%), proving `list()` runs.

- [ ] **Step 2: Write the throwaway config (current production settings, scoped)**

```bash
cat > /tmp/stryker.A3.json <<'EOF'
{
  "testRunner": "bun",
  "appendPlugins": ["@hughescr/stryker-bun-runner", "@stryker-mutator/typescript-checker"],
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "bun": { "timeout": 120000 },
  "mutate": ["src/providers/kaneo/column-resource.ts"],
  "coverageAnalysis": "perTest",
  "ignoreStatic": true,
  "incremental": false,
  "concurrency": 8,
  "timeoutMS": 60000,
  "thresholds": { "high": 80, "low": 60, "break": 0 },
  "reporters": ["clear-text", "json"],
  "jsonReporter": { "fileName": "/tmp/A3.mutation.json" },
  "ignorePatterns": ["node_modules", ".stryker-tmp"]
}
EOF
```

- [ ] **Step 3: Run it (background) and wait**

Launch with `run_in_background: true`: `bunx stryker run /tmp/stryker.A3.json`
Then poll: `until grep -qiE "Done in|ERROR Stryker" <output-file>; do sleep 5; done`
Expected: completes in 1–3 min; clear-text shows mostly Ignored(static)/NoCoverage, 0 or near-0 Killed for `column-resource.ts`.

- [ ] **Step 4: Count static vs the rest from the scoped JSON**

Run:

```bash
node -e '
const r=require("/tmp/A3.mutation.json");let c={};
for(const f of Object.values(r.files||{}))for(const m of f.mutants)c[m.status]=(c[m.status]||0)+1;
console.log(JSON.stringify(c,null,2));
'
```

Expected: a large `Ignored` count (static) relative to a small `NoCoverage`/`Killed`/`Survived`, reproducing the file-level collapse (~69/85 static observed previously).

- [ ] **Step 5: Record into A3**

Record: the bun-coverage proof that `list()` runs, the scoped status counts, and the contradiction (executed code → yet classified static/no-cov). Include the exact commands in the Appendix.

- [ ] **Step 6: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A3 reproduce static collapse on column-resource"
```

---

## Task 4 (A4): Variable test — concurrency

**Files:**

- Ephemeral: `/tmp/stryker.A4.json`
- Modify: findings report → section `### A4. Variable test — concurrency`

- [ ] **Step 1: Copy the A3 config but set `concurrency: 1`**

```bash
sed 's/"concurrency": 8/"concurrency": 1/; s#/tmp/A3.mutation.json#/tmp/A4.mutation.json#' /tmp/stryker.A3.json > /tmp/stryker.A4.json
```

- [ ] **Step 2: Run it (background) and wait**

Launch `bunx stryker run /tmp/stryker.A4.json` with `run_in_background: true`; poll with the same `until` loop.
Expected: completes in 1–3 min.

- [ ] **Step 3: Compare status counts to A3**

Run the same `node -e` counter against `/tmp/A4.mutation.json`.
Expected: EITHER the static share drops sharply (→ concurrency is implicated) OR it is unchanged (→ concurrency is not the cause).

- [ ] **Step 4: Record into A4**

Record both count sets side by side and the verdict: "Setting `concurrency:1` {did / did not} reduce the static share, {confirming / ruling out} the concurrency hypothesis."

- [ ] **Step 5: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A4 concurrency variable test"
```

---

## Task 5 (A5): Variable test — preload isolation

**Files:**

- Read-only reference: `node_modules/@hughescr/stryker-bun-runner/README.md`, `bunfig.toml`
- Ephemeral: `/tmp/stryker.A5.json`
- Modify: findings report → section `### A5. Variable test — preload isolation`

> The suite preloads `./tests/setup.ts` and `./tests/mock-reset.ts` via `bunfig.toml`. We must NOT edit `bunfig.toml`. This task first checks whether the runner lets us override the preload set from the Stryker config (so we can drop `mock-reset.ts` without touching committed files). If it cannot, we document the limitation and lean on A2 + B2 instead.

- [ ] **Step 1: Check whether preload is overridable without editing committed files**

Run:

```bash
grep -niE "preload|bunfig|SAFE_TEST_KEYS|--config|--preload" node_modules/@hughescr/stryker-bun-runner/README.md
grep -rniE "preload|bunfig" node_modules/@hughescr/stryker-bun-runner/dist/ | head -30
```

Expected: confirmation of how preload is sourced. Decide: is there a config-level (`bun: { ... }`) or env override for preload?

- [ ] **Step 2a: IF overridable — run with `mock-reset.ts` removed from preload**

Write `/tmp/stryker.A5.json` as a copy of `/tmp/stryker.A3.json` with the discovered override making preload only `./tests/setup.ts` (output to `/tmp/A5.mutation.json`). Run in background, poll, then run the `node -e` counter on `/tmp/A5.mutation.json`.
Expected: EITHER static share drops (→ `mock-reset.ts`/global hooks implicated) OR unchanged (→ not the cause).

- [ ] **Step 2b: IF NOT overridable — document the constraint**

Record that isolating the preload would require a temporary edit to committed `bunfig.toml`, which is out of scope for this read-only investigation, and that the preload hypothesis is therefore assessed via A2 (mechanism) and B2 (mock.module blast radius) instead.

- [ ] **Step 3: Record into A5**

Record the capability finding, the experiment result (or the documented constraint), and the verdict on the preload/hook hypothesis.

- [ ] **Step 4: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A5 preload isolation variable test"
```

---

## Task 6 (A6): True-score probe with `ignoreStatic:false`

**Files:**

- Ephemeral: `/tmp/stryker.A6.json`
- Read-only reference: `src/providers/kaneo/search-tasks.ts` + `tests/providers/kaneo/search-tasks.test.ts` (small, has tests, currently 50% over 4 valid mutants)
- Modify: findings report → section `### A6. True-score probe (ignoreStatic:false, scoped)`

> With `ignoreStatic:false`, static mutants run against the suite, so this is slow even on one file. Scope to a SMALL tested file and run in background. This produces a per-file true score; the full-repo true score is a deferred option (C3), not run here.

- [ ] **Step 1: Write the throwaway config (perTest + ignoreStatic:false, scoped)**

```bash
cat > /tmp/stryker.A6.json <<'EOF'
{
  "testRunner": "bun",
  "appendPlugins": ["@hughescr/stryker-bun-runner", "@stryker-mutator/typescript-checker"],
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "bun": { "timeout": 120000 },
  "mutate": ["src/providers/kaneo/search-tasks.ts"],
  "coverageAnalysis": "perTest",
  "ignoreStatic": false,
  "incremental": false,
  "concurrency": 8,
  "timeoutMS": 60000,
  "thresholds": { "high": 80, "low": 60, "break": 0 },
  "reporters": ["clear-text", "json"],
  "jsonReporter": { "fileName": "/tmp/A6.mutation.json" },
  "ignorePatterns": ["node_modules", ".stryker-tmp"]
}
EOF
```

- [ ] **Step 2: Run it (background) and wait**

Launch `bunx stryker run /tmp/stryker.A6.json` with `run_in_background: true`. Poll with the `until` loop. Expected duration: roughly 5–20 min (full suite dry-run ~80s + a few static mutants × suite). If it exceeds ~30 min, stop it (`pkill -f stryker.A6.json`) and record that the per-file true-score probe is cost-bound and deferred.

- [ ] **Step 3: Compute the per-file true score**

Run:

```bash
node -e '
const r=require("/tmp/A6.mutation.json");let c={};
for(const f of Object.values(r.files||{}))for(const m of f.mutants)c[m.status]=(c[m.status]||0)+1;
const valid=(c.Killed||0)+(c.Survived||0)+(c.NoCoverage||0)+(c.Timeout||0);
console.log(JSON.stringify(c,null,2));
console.log("per-file true score",(100*((c.Killed||0)+(c.Timeout||0))/valid).toFixed(1)+"%");
'
```

Expected: many mutants that were Ignored(static) under A3 are now Killed/Survived — i.e. the existing tests DO kill them once attribution is corrected. Record how many flipped from static→killed.

- [ ] **Step 4: Record into A6**

Record the before/after for this file (A3 static-dominated vs A6 killed/survived), the per-file true score, and an explicit statement of extrapolation uncertainty: "this single-file probe suggests the repo-wide true score is materially higher than 23.54%, but a full `ignoreStatic:false` run (deferred, C3) is required to quantify it."

- [ ] **Step 5: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): A6 per-file true-score probe (ignoreStatic:false)"
```

---

## Task 7 (B1): Preload architecture catalog

**Files:**

- Read-only: `bunfig.toml`, `tests/setup.ts`, `tests/mock-reset.ts`
- Modify: findings report → section `### B1. Preload architecture`

- [ ] **Step 1: Read the preloads in full**

Run: `cat bunfig.toml tests/setup.ts tests/mock-reset.ts`
Expected: `bunfig.toml` preloads `./tests/setup.ts` then `./tests/mock-reset.ts`; `setup.ts` silences console/logger; `mock-reset.ts` captures real exports at startup and restores them in a global `beforeEach`, with a global `afterEach` restoring spies.

- [ ] **Step 2: Catalog effects, ordering, and risks**

Document: (1) what each preload does; (2) the documented per-test order (global `beforeEach` restore → file `beforeEach` mocks → test → global `afterEach` restore spies); (3) process-wide effects and leakage risks (e.g. `mock.module()` leaking across files, which is the stated reason originals are captured); (4) coupling/robustness concerns.

- [ ] **Step 3: Record into B1**

Write the catalog as a short subsection with a bullet per file and a "Risks/Smells" list.

- [ ] **Step 4: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): B1 preload architecture catalog"
```

---

## Task 8 (B2): mock.module() blast radius

**Files:**

- Read-only: `tests/**`, `stryker.config.json` (mutate globs)
- Modify: findings report → section `### B2. mock.module() blast radius`

- [ ] **Step 1: Count and locate every `mock.module()`**

Run:

```bash
grep -rn "mock\.module(" tests/ | wc -l
grep -rn "mock\.module(" tests/ | sed -E "s/.*mock\.module\(['\"]([^'\"]+)['\"].*/\1/" | sort | uniq -c | sort -rn | head -40
```

Expected: a total count and a ranked list of mocked module specifiers.

- [ ] **Step 2: Identify which mocked modules are in the mutate scope**

The mutate scope (from `stryker.config.json`) includes `src/providers/**`, `src/tools/**`, `src/errors.ts`, `src/config.ts`, `src/memory.ts`, `src/cron.ts`, `src/recurring.ts`, `src/history.ts`, `src/conversation.ts`. Cross-reference the ranked list against these paths. Run:

```bash
grep -rn "mock\.module(" tests/ | grep -E "config\.js|memory\.js|recurring\.js|history\.js|conversation\.js|cron\.js|providers/|tools/" | head -40
```

Expected: a list of in-scope modules that are mock.module()'d — each is a module whose instrumentation is defeated when tests run against the mock instead of the real code.

- [ ] **Step 3: Record into B2**

Record: total `mock.module()` count; the top-N mocked modules table (module | occurrences | in-mutate-scope?); and a short analysis of blast radius and the link to no-coverage/static for in-scope modules.

- [ ] **Step 4: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): B2 mock.module blast radius"
```

---

## Task 9 (B3): DI adherence

**Files:**

- Read-only: `tests/CLAUDE.md`, `tests/**`, `src/tools/**` (constructor/factory injection patterns)
- Modify: findings report → section `### B3. DI adherence`

- [ ] **Step 1: Restate the repo's stated preference**

Run: `grep -n -A2 -i "DI\|dependency inject\|mock.module" tests/CLAUDE.md`
Expected: the guidance "prefer DI over `mock.module()` where the module already supports it."

- [ ] **Step 2: Measure DI vs mock.module usage**

Run:

```bash
echo "files using mock.module:"; grep -rl "mock\.module(" tests/ | wc -l
echo "files using DI helpers (getToolExecutor/provider injection):"; grep -rlE "getToolExecutor\(|makeTools\(|new [A-Z][A-Za-z]+Resource\(|provider:" tests/ | wc -l
```

Expected: counts that let you state the ratio and identify whether `mock.module()` is used where DI was available.

- [ ] **Step 3: Sample 3 representative divergences**

Pick three test files that use `mock.module()` for a module that is constructor/parameter-injectable (e.g. a provider resource or a tool factory). For each, record file path and a one-line note on why DI would have avoided the module mock.

- [ ] **Step 4: Record into B3**

Record the counts, the ratio, the three sampled divergences, and a verdict on adherence (high / mixed / low) with the highest-impact gap.

- [ ] **Step 5: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): B3 DI adherence assessment"
```

---

## Task 10 (B4): Test-quality signals from mutation data

**Files:**

- Read-only: `reports/mutation.json`
- Modify: findings report → section `### B4. Test-quality signals from mutation data`

- [ ] **Step 1: Rank files by survived mutants (assertion-strength proxy)**

Run:

```bash
node -e '
const r=require("./reports/mutation.json");const rows=[];
for(const[p,f]of Object.entries(r.files||{})){let s=0,nc=0;for(const m of f.mutants){if(m.status==="Survived")s++;else if(m.status==="NoCoverage")nc++;}if(s+nc>0)rows.push({p:p.replace("src/",""),s,nc});}
console.log("TOP SURVIVED:");rows.slice().sort((a,b)=>b.s-a.s).slice(0,12).forEach(x=>console.log(" ",x.p,"survived="+x.s));
console.log("TOP NO-COVERAGE:");rows.slice().sort((a,b)=>b.nc-a.nc).slice(0,12).forEach(x=>console.log(" ",x.p,"nocov="+x.nc));
'
```

Expected: two ranked lists. High-survived files = weak assertions; high-no-coverage files = code not exercised (over-mocking or untested).

- [ ] **Step 2: Classify the top offenders**

For the top ~6 of each list, label each as one of: weak-assertions, over-mocked (unit stubbed away), genuinely-untested (no test file exists — check with `find tests -name "<base>*.test.ts"`), or measurement-artifact (static collapse per A2/A3).

- [ ] **Step 3: Record into B4**

Record both ranked tables with the per-file classification column, and a short narrative on the dominant quality signal.

- [ ] **Step 4: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): B4 test-quality signals from mutation data"
```

---

## Task 11 (B5 + C1): Interaction synthesis and root-cause statement

**Files:**

- Modify: findings report → sections `### B5. Interaction with mutation measurement` and `### C1. Root-cause statement`

- [ ] **Step 1: Write B5 — how preloads/mocks/DI affect measurement**

Connect B1–B4 to Track A: explain how `mock.module()` of in-scope modules (B2) and the global-hook preload design (B1) plausibly feed the static collapse (A2–A5), and how over-mocking (B4) produces no-coverage. Cite the specific tasks' evidence.

- [ ] **Step 2: Write C1 — the single root-cause statement**

State the proven cause(s) in 3–6 sentences, distinguishing **measurement defect** (static discard) from **genuine test-quality gaps** (weak assertions, untested files). Mark each contributing hypothesis as Proven / Disproven / Inconclusive, citing the task that decided it.

- [ ] **Step 3: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): B5 interaction synthesis + C1 root cause"
```

---

## Task 12 (C2 + C3): Quality assessment and deferred options

**Files:**

- Modify: findings report → sections `### C2. Quality assessment` and `### C3. Options for a future effort (deferred — not executed)`

- [ ] **Step 1: Write C2 — prioritized quality assessment**

Summarize the test-infra quality verdict with the metrics from B1–B4 (mock.module count, in-scope-mocked count, DI ratio, top survived/no-cov files). Rank the issues by impact on (a) measurement accuracy and (b) genuine confidence.

- [ ] **Step 2: Write C3 — deferred remediation options**

For each contributing cause, list one or more options with trade-offs, each tagged **Deferred — not executed**. Cover at minimum: (1) measurement config (e.g. `ignoreStatic:false` with per-area/incremental runs, or `concurrency`/preload adjustments if A4/A5 implicated them); (2) reducing in-scope `mock.module()` via DI; (3) full-repo true-score run as a one-off/CI job; (4) threshold policy (gate/ratchet) once measurement is trustworthy. Do NOT recommend a single path as decided — present options for a separate brainstorming/approval.

- [ ] **Step 3: Commit**

```bash
bun format && git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): C2 quality assessment + C3 deferred options"
```

---

## Task 13: Executive summary, appendix, self-review, finalize

**Files:**

- Modify: findings report → sections `## 1. Executive Summary` and `## 5. Appendix — Commands & Raw Outputs`

- [ ] **Step 1: Write the Executive Summary**

3–5 sentences: the headline (23.54% over only 16.1% of mutants), the proven root cause from C1, the single most important quality finding from C2, and a pointer to C3 options. No new claims — only summarize what the tracks proved.

- [ ] **Step 2: Fill the Appendix**

Paste the exact commands and key raw outputs used in A1, A3, A4, A5, A6, B2, B3, B4 so every claim is reproducible. Note that all `/tmp/stryker.*.json` configs were ephemeral and no committed file was changed.

- [ ] **Step 3: Self-review against the spec**

Verify: (a) every spec Track item (A1–A3, B1–B5, C1–C3) maps to a filled section; (b) no "TBD"/placeholder text remains (`grep -niE "TBD|TODO|fill in|_\(filled" docs/research/2026-05-24-*.md` returns nothing but the intentional Step-1 marker, now replaced); (c) every Proven/Disproven verdict cites evidence; (d) no `src/`/`tests/` file was modified (`git status --short` shows only the report).

- [ ] **Step 4: Final checks and commit**

```bash
git status --short              # expect only docs/research/... (and possibly the pre-existing M stryker.config.json, untouched)
bun format && bun format:check && bun license:headers
git add docs/research/2026-05-24-mutation-measurement-and-test-quality-findings.md
git commit -m "docs(research): finalize mutation measurement & test-quality findings"
```

Expected: `format:check` clean, `license:headers` clean, working tree contains no `src/`/`tests/` edits.

---

## Self-Review (plan author)

- **Spec coverage:** A1–A3 → Tasks 1–6; B1–B5 → Tasks 7–11; C1–C3 → Tasks 11–12; deliverable report + appendix → Tasks 0, 13. ✓
- **No `src/`/`tests/` changes:** every task is read-only analysis or report edits; experiments use `/tmp` configs; the constraint is restated in the header and re-checked in Task 13 Step 3. ✓
- **Placeholder scan:** report skeleton uses one explicit `_(filled …)_` marker in Task 0 that Task 13 replaces; all command/recording steps are concrete. ✓
- **Consistency:** ephemeral config filenames (`/tmp/stryker.A3.json` … `A6`), JSON outputs (`/tmp/A3.mutation.json` …), and the single report path are used consistently across tasks; the `node -e` status-counter shape is identical everywhere. ✓
- **Feasibility caveats encoded:** A5 has an explicit overridable/not-overridable branch; A6 has a cost cap with a stop-and-defer fallback; the full-repo true score is explicitly deferred to C3. ✓
