<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Stryker TS7 unblock — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stryker mutation testing run under `typescript@7.0.2` by removing the incompatible `@stryker-mutator/typescript-checker` plugin, leaving the bun test runner as the sole mutant-killer.

**Architecture:** TS7 moved all compiler APIs behind the `typescript/unstable/*` subpaths, so `require('typescript')` now returns only `{ version, versionMajorMinor }`. The type-checker plugin imports the bare namespace and crashes. Stryker core and `@hughescr/stryker-bun-runner` never import `typescript` (Bun compiles TS natively), so dropping the checker is sufficient. This is a pure config/dependency removal — no source changes, no shim.

**Tech Stack:** StrykerJS 9.6.1, `@hughescr/stryker-bun-runner` 1.3.8, TypeScript 7.0.2, Bun 1.3.x, knip.

**Source spec:** `docs/superpowers/specs/2026-07-24-stryker-ts7-unblock-design.md`

## Global Constraints

- Work on branch `mutation-testing-revive` only.
- Runtime: **Bun** (never `npm`/`yarn`). Install with `bun install`.
- Never add lint-disable / type-ignore comments — fix the underlying issue.
- Never commit secrets. Exact file paths in every step.
- This is local-only tooling: no source under `src/` or `tests/` is touched.
- The type-checker removal is intentional and documented — do not re-add it (see spec's "Re-enable condition").

## File Structure

- **Modify** `stryker.config.json` — drop the checker plugin, `checkers`, `tsconfigFile`.
- **Modify** `knip.config.ts` — drop the checker from `ignoreDependencies` + its stale comment.
- **Modify** `package.json` — drop the checker from `devDependencies`.
- **Sync** `bun.lock` via `bun install`.
- **Ephemeral** `/tmp/stryker.smoke.json` — throwaway scoped config for the verification run (not committed; established repo pattern).

---

### Task 1: Drop the type-checker plugin (config + deps + knip + lockfile)

**Files:**
- Modify: `stryker.config.json:3-5`
- Modify: `knip.config.ts:92-97`
- Modify: `package.json:111`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a Stryker config with no `typescript` checker; a `node_modules` tree without `@stryker-mutator/typescript-checker`; a knip ignore list with no phantom dependency.

- [ ] **Step 1: Remove checker wiring from `stryker.config.json`**

Replace these three lines (current `stryker.config.json:3-5`):

```json
  "appendPlugins": ["@hughescr/stryker-bun-runner", "@stryker-mutator/typescript-checker"],
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
```

with:

```json
  "appendPlugins": ["@hughescr/stryker-bun-runner"],
```

(The `"bun": {` block that followed stays unchanged on the next line. `tsconfigFile`/`checkers` were checker-only.)

- [ ] **Step 2: Confirm the edited `stryker.config.json` is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('stryker.config.json','utf8')); console.log('valid')"`
Expected: prints `valid`, exit 0.

- [ ] **Step 3: Remove the checker from `knip.config.ts` ignoreDependencies**

Replace this block (current `knip.config.ts:92-93` + the array on `:97`).

First the comment (replace):

```ts
  // @stryker-mutator/typescript-checker is loaded at runtime by Stryker, not
  // imported. msw is the dev-only mock layer consumed exclusively by the
```

with:

```ts
  // msw is the dev-only mock layer consumed exclusively by the
```

Then the array (replace):

```ts
  ignoreDependencies: ['@stryker-mutator/typescript-checker', 'msw', '@crvy/strybk'],
```

with:

```ts
  ignoreDependencies: ['msw', '@crvy/strybk'],
```

- [ ] **Step 4: Remove the checker from `package.json` devDependencies**

Replace (current `package.json:110-112`):

```json
    "@stryker-mutator/core": "^9.6.0",
    "@stryker-mutator/typescript-checker": "^9.6.0",
    "@sveltejs/vite-plugin-svelte": "^7",
```

with:

```json
    "@stryker-mutator/core": "^9.6.0",
    "@sveltejs/vite-plugin-svelte": "^7",
```

- [ ] **Step 5: Sync the lockfile and remove the package**

Run: `bun install`
Expected: completes; output mentions removing `@stryker-mutator/typescript-checker`. The `bun.lock` diff should touch only that package (plus any of its exclusive transitive deps). If the diff is larger, reconcile only the checker's entry before continuing.

- [ ] **Step 6: Verify the package is gone from node_modules**

Run: `ls node_modules/@stryker-mutator/`
Expected: lists only `core` (and any sibling like `util` that `core` pulls in). `typescript-checker` must NOT appear.

- [ ] **Step 7: Run knip — must be green**

Run: `bun run knip`
Expected: exit 0, no errors. The removed `ignoreDependencies` entry no longer references a phantom dependency, so nothing new should surface. If knip now reports `@stryker-mutator/core` as unused, STOP — that means the config edit in Step 1 was wrong (core is still referenced via `appendPlugins`); recheck `stryker.config.json`.

- [ ] **Step 8: Run lint + typecheck — must be green**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0. (App typechecking uses the project's own `tsc`; removing the checker does not affect it.)

- [ ] **Step 9: Confirm exactly the expected files changed**

Run: `git status --short`
Expected (order may vary):
```
 M knip.config.ts
 M package.json
 M stryker.config.json
 M bun.lock
```
If anything else appears, do not commit it — investigate.

- [ ] **Step 10: Commit**

```bash
git add stryker.config.json knip.config.ts package.json bun.lock
git commit -m "build(stryker): drop TS7-incompatible typescript-checker

typescript@7.0.2 moved all compiler APIs behind the typescript/unstable/*
subpaths, so the main entry now exposes only version metadata.
@stryker-mutator/typescript-checker@9.6.1 (latest; no upstream TS7
support) imports the bare namespace and crashes at runtime.

Stryker core and @hughescr/stryker-bun-runner never import typescript
(Bun compiles TS natively), so dropping the checker is sufficient to
unblock mutation testing. The bun test runner (coverageAnalysis: perTest)
becomes the sole mutant-killer. Trade-off: mutants that break only types
now survive instead of being type-check-killed.

Re-enable only when upstream ships a checker compatible with the TS7
package layout. See docs/superpowers/specs/2026-07-24-stryker-ts7-unblock-design.md"
```

---

### Task 2: Prove the unblock with a scoped Stryker smoke run

**Files:**
- Create (ephemeral, NOT committed): `/tmp/stryker.smoke.json`

**Interfaces:**
- Consumes: Task 1's committed config shape (no checker) + the bun runner.
- Produces: a successful scoped mutation report at `/tmp/stryker.smoke.json` proving Stryker runs under TS7. No repo change.

- [ ] **Step 1: Write the throwaway scoped config**

Run:

```bash
cat > /tmp/stryker.smoke.json <<'EOF'
{
  "testRunner": "bun",
  "appendPlugins": ["@hughescr/stryker-bun-runner"],
  "bun": { "timeout": 120000 },
  "mutate": ["src/errors.ts"],
  "coverageAnalysis": "perTest",
  "ignoreStatic": true,
  "incremental": false,
  "concurrency": 8,
  "timeoutMS": 60000,
  "thresholds": { "high": 80, "low": 60, "break": 0 },
  "reporters": ["clear-text", "json"],
  "jsonReporter": { "fileName": "/tmp/stryker.smoke.json" },
  "ignorePatterns": ["node_modules", ".stryker-tmp", "reports"]
}
EOF
```

This mirrors the new committed config (no checker) but scopes mutation to the single, small `src/errors.ts`, disables incremental (no `reports/` pollution), and sets `break: 0` so a low score never fails the run.

- [ ] **Step 2: Run Stryker (background) and capture output**

Launch in the background, redirecting output to a log:

```bash
nohup bunx stryker run /tmp/stryker.smoke.json > /tmp/stryker.smoke.log 2>&1 &
```

Poll until it finishes (1–3 min):

```bash
until grep -qiE "Done in|ERROR Stryker|All tests|mutation score" /tmp/stryker.smoke.log; do sleep 5; done
```

- [ ] **Step 3: Confirm NO TS7 checker crash**

Run: `grep -iE "ts\.sys|createSolutionBuilderWithWatch|parseConfigFileTextToJson|typescript-checker|Cannot read prop.*of undefined|is not a function" /tmp/stryker.smoke.log || echo "NO TS7 CRASH"`
Expected: prints `NO TS7 CRASH` (the grep finds nothing). If it prints matches, the checker is somehow still active — STOP and recheck Task 1 Step 1 (the `appendPlugins` must not contain the checker, and `checkers`/`tsconfigFile` must be gone).

- [ ] **Step 4: Confirm a report was produced**

Run: `node -e "const r=require('/tmp/stryker.smoke.json'); const f=(r.files||[]).find(f=>f.name.endsWith('errors.ts')); console.log('report files:', r.files.length, '| errors.ts present:', !!f);"`
Expected: `errors.ts present: true` and a non-zero `files.length`. This proves Stryker completed a real mutation cycle under TS7.

- [ ] **Step 5: Read the clear-text score (informational only)**

Run: `grep -iE "mutation score|All files|errors" /tmp/stryker.smoke.log | head`
Expected: a mutation-score line for `src/errors.ts`. The exact score is irrelevant to this task (score tuning is out of scope); the only acceptance criteria are Steps 3 and 4.

- [ ] **Step 6: Clean up ephemeral files**

Run: `rm -f /tmp/stryker.smoke.json /tmp/stryker.smoke.log`
Expected: no output. (These were never committed; `git status` remains clean with only Task 1's commit ahead of `origin`.)

- [ ] **Step 7: Final repo-state confirmation**

Run: `git status --short && git log --oneline -1`
Expected: clean working tree; top commit is the Task 1 `build(stryker): drop TS7-incompatible typescript-checker` commit. Mutation testing is unblocked.

---

## Done criteria

- `@stryker-mutator/typescript-checker` removed from `stryker.config.json`, `package.json`, `knip.config.ts`, and `bun.lock`.
- `bun run knip`, `bun run lint`, `bun run typecheck` all green.
- A scoped Stryker run under TS7 completes and emits a report with no TS7 crash.

## Out of scope (follow-ups)

- Full-suite `bun test:mutate` run + mutation-score tuning.
- Re-adding a type-checker once upstream supports TS7 (tracked by the spec's "Re-enable condition").
- Any change to the bun runner, coverage settings, or `mutate` globs.
