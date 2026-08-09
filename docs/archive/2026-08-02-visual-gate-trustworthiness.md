<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Visual-Gate Trustworthiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a green Storybook screenshot run mean something, by regenerating the CSS
bundles on every run and adding an opt-in high-sensitivity comparator mode.

**Architecture:** Two independent config-level changes to `playwright.config.ts`. A
`globalSetup` module shells out to the existing `storybook:prepare` script so every run
renders against current CSS instead of whatever a warm Storybook booted with. An explicit
`expect.toHaveScreenshot` block reads `process.env.VISUAL_AUDIT` and drops the pixelmatch
threshold from `0.2` to `0.02` when set, exposed through a new `visual:audit` package script.
The default path is unchanged.

**Tech Stack:** Playwright `^1.61.1` (`@playwright/test`), `@crvy/strybk` (the `sharedPage`
fixture and `switchStory` helper), Storybook dev server on port 6006, Bun as runtime and
script runner, `oxfmt` as formatter.

**Spec:** `docs/superpowers/specs/2026-08-02-visual-gate-trustworthiness-design.md`

## Global Constraints

- **Never add lint-disable or type-ignore comments** (`eslint-disable`, `oxlint-disable`,
  `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`). The pre-tool-use hook blocks them. Fix the
  underlying issue instead.
- **Use the `.js` extension in relative import paths** (repo-wide TypeScript convention).
- **Error extraction is `error instanceof Error ? error.message : String(error)`.**
- **The formatter is `oxfmt`, invoked as `bun run format`** — not prettier.
- **The default (non-audit) visual path must stay behaviourally identical to today:**
  `threshold: 0.2`, one `chromium` project, `snapshotPathTemplate` untouched. Audit
  sensitivity is opt-in only.
- **Exact values, verbatim:** audit threshold `0.02`; default threshold `0.2`; environment
  variable `VISUAL_AUDIT` compared against the string `'1'`; package script named
  `visual:audit`.
- **`.storybook-shots/` is gitignored and must stay that way.** Never `git add` a baseline PNG.
- **`client/shared/tokens.css` is edited only as a temporary experiment.** Every task that
  touches it reverts it before committing. `git status` must show no `tokens.css` change in any
  commit this plan produces.
- **`DebugApp` carries a live uptime counter** that produces a spurious diff on every run. Five
  such failures are the known floor; discount them, do not investigate them.
- **Baselines are local artifacts**, currently at the known floor of 449 passing + 5 `DebugApp`
  flakes across 111 spec files. Do not run `bun shoot` (`playwright test --update-snapshots`)
  anywhere in this plan — re-baselining would destroy the very comparison the tasks rely on.

---

## File Structure

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `tests/visual/support/global-setup.ts` | Create | Invoke `bun run storybook:prepare` once per Playwright run, failing loudly if it errors |
| `playwright.config.ts` | Modify | Wire `globalSetup`; declare an explicit `expect.toHaveScreenshot` block whose `threshold` is env-gated |
| `package.json` | Modify | Add the `visual:audit` script |
| `docs/architecture/storybook-screenshots.md` | Modify | Replace the now-false "regression testing is out of scope" claim; document audit mode and per-run CSS regeneration |

**Note on placement:** the spec named `tests/visual/global-setup.ts`. This plan uses
`tests/visual/support/global-setup.ts` instead, because `tests/visual/support/` is already the
established home for non-spec helpers (`tests/visual/support/viewport.ts`, imported by all 111
specs). Playwright's default `testMatch` only collects `*.spec.ts` / `*.test.ts`, so either
location is safe from being run as a test; the `support/` subdirectory simply follows the
local pattern.

---

## Task 1: Per-run CSS bundle regeneration

Closes the staleness trap: a warm Storybook currently serves the token snapshot it booted
with, so a run can pass against CSS that no longer matches the source tree.

**Files:**

- Create: `tests/visual/support/global-setup.ts`
- Modify: `playwright.config.ts` (add one `globalSetup` line)
- Temporarily edit and revert: `client/shared/tokens.css:21`

**Interfaces:**

- Consumes: the existing `storybook:prepare` script in `package.json` (do not re-implement its
  `cat` chain — invoke it).
- Produces: `tests/visual/support/global-setup.ts` with a **default export** of a zero-argument
  function, referenced from `playwright.config.ts` as `globalSetup:
  './tests/visual/support/global-setup.ts'`. Task 2 modifies the same config file but does not
  touch this line.

### Steps

- [ ] **Step 1: Start a warm Storybook and leave it running**

The bug only manifests against a server that was already up, so this must happen *before* any
CSS edit. Run in a background shell:

```bash
bun storybook
```

Wait until this returns HTTP 200 (it may take up to 120 s on a cold start):

```bash
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:6006/index.json
```

Expected: `200`

If a Storybook is already running from an earlier session, **restart it** — you need to know
it booted before the edit in Step 3, and a server of unknown age gives an unreadable result.

- [ ] **Step 2: Confirm the chosen spec passes right now**

`AdminTopBar` is the probe: `client/admin/components/AdminTopBar.svelte:78` is
`color: var(--fg3)`, and `--fg3` resolves to `--text-dim`, the token about to be edited. Its
single baseline is `.storybook-shots/admin/components/AdminTopBar.spec.ts/admin-components-AdminTopBar-Default-1.png`.

Run:

```bash
bunx playwright test tests/visual/admin/components/AdminTopBar.spec.ts
```

Expected: `1 passed`

If this fails, the local baseline is already stale for an unrelated reason. Stop and report —
do not proceed, and do not "fix" it with `bun shoot`.

- [ ] **Step 3: Reproduce the bug (the red step)**

Edit `client/shared/tokens.css` line 21, changing the `--text-dim` value to a glaring red. Do
not touch the trailing comment:

```css
--text-dim: #ff0000; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */
```

Re-run the exact same command:

```bash
bunx playwright test tests/visual/admin/components/AdminTopBar.spec.ts
```

Expected: **`1 passed`** — and that is the defect. Pure red against a dark background is an
enormous pixel delta; it passes only because the warm server is still serving the CSS bundle
it booted with, so the browser never saw the new value.

**If this instead FAILS**, the staleness bug does not reproduce in your environment. Do not
continue and do not "fix" anything — revert `tokens.css`, and report the outcome with the test
output. The premise of this task would be wrong and that is worth more than a plausible guess.

- [ ] **Step 4: Revert the token edit**

```bash
git checkout -- client/shared/tokens.css
git diff --stat client/shared/tokens.css
```

Expected: no output from `git diff --stat` (the file is clean).

- [ ] **Step 5: Create the global setup module**

Create `tests/visual/support/global-setup.ts` with exactly this content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Regenerate the concatenated Storybook CSS bundles before every visual run.
 *
 * `storybook:prepare` cats `client/shared/base.css` + `client/shared/tokens.css` (plus the
 * per-SPA stylesheet) into `public/storybook-*.css`, and package.json wires it to *server
 * start*. With `webServer.reuseExistingServer: true`, a warm Storybook means Playwright never
 * executes `webServer.command` — so a long-running server keeps serving the token snapshot it
 * booted with. Sub-project G lost an entire audit to this: the suite reported its normal pass
 * rate while the browser rendered four-hour-old colors.
 *
 * Running it here couples regeneration to the run rather than to the server. Vite serves
 * `public/` from disk per request, so the dev server picks up the new bundles without a
 * restart. Measured cost is ~112 ms, which is why it can run on every `bun shoot -g <Section>`
 * without disturbing the warm loop. Do not remove it as an optimisation: its absence fails
 * silently, by passing.
 */
export default function globalSetup(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

  try {
    execFileSync('bun', ['run', 'storybook:prepare'], { cwd: repoRoot, stdio: 'pipe' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `storybook:prepare failed, so visual runs would render stale CSS: ${detail}`,
    )
  }
}
```

- [ ] **Step 6: Wire it into the Playwright config**

In `playwright.config.ts`, add a `globalSetup` entry immediately after the `outputDir` line.
The surrounding lines are shown for placement; only the `globalSetup` line is new:

```typescript
  outputDir: '.storybook-shots/test-results',
  // Regenerates public/storybook-*.css per run. A warm server would otherwise serve the
  // token snapshot it booted with — see the module's doc comment.
  globalSetup: './tests/visual/support/global-setup.ts',
  fullyParallel: true,
```

- [ ] **Step 7: Verify the fix (the green step)**

Re-apply the same red value to `client/shared/tokens.css` line 21:

```css
--text-dim: #ff0000; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */
```

Run against the still-warm Storybook from Step 1 — do not restart it, or the test proves
nothing:

```bash
bunx playwright test tests/visual/admin/components/AdminTopBar.spec.ts
```

Expected: **`1 failed`**, with a screenshot-comparison error naming
`admin-components-AdminTopBar-Default-1.png`.

- [ ] **Step 8: Revert and confirm the spec passes again**

```bash
git checkout -- client/shared/tokens.css
bunx playwright test tests/visual/admin/components/AdminTopBar.spec.ts
```

Expected: `1 passed`

This third state matters: it shows the failure in Step 7 tracked the CSS rather than being a
side effect of adding `globalSetup`.

- [ ] **Step 9: Typecheck and lint**

```bash
bun run typecheck && bun run lint
```

Expected: both pass.

- [ ] **Step 10: Confirm the working tree contains only the intended changes**

```bash
git status --porcelain
```

Expected exactly:

```
 M playwright.config.ts
?? tests/visual/support/global-setup.ts
```

If `client/shared/tokens.css` appears, revert it before committing.

- [ ] **Step 11: Format and commit**

```bash
bun run format
git add playwright.config.ts tests/visual/support/global-setup.ts
git commit -m "fix(visual): regenerate storybook CSS bundles on every playwright run"
```

---

## Task 2: Opt-in audit mode

Adds a high-sensitivity comparator behind an environment variable, so a deliberate
cross-cutting change can be audited without imposing flake risk on the everyday warm loop.

**Files:**

- Modify: `playwright.config.ts` (add an `expect` block)
- Modify: `package.json` (add one script beside `"shoot"`)
- Temporarily edit and revert: `client/shared/tokens.css:21`

**Interfaces:**

- Consumes: `globalSetup` from Task 1, already wired in `playwright.config.ts`. Leave that line
  untouched. Step 5's experiment depends on it working — without per-run regeneration the
  token edit would not reach the browser at all.
- Produces: the `visual:audit` package script and the `VISUAL_AUDIT=1` convention, both
  documented in Task 3.

### Steps

- [ ] **Step 1: Add the env-gated expect block**

In `playwright.config.ts`, add this constant directly below the existing `STORYBOOK_URL`
declaration:

```typescript
const AUDIT = process.env.VISUAL_AUDIT === '1'
```

Then add an `expect` block immediately after the `projects` array:

```typescript
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  expect: {
    toHaveScreenshot: {
      // pixelmatch's per-pixel cutoff is 35215 × threshold². The default 0.2 gives 1408.6,
      // which silently passes any dim-on-dark color change under ~1400 YIQ delta — sub-project
      // G's --fg3 change measured 264.7 and was invisible to all 111 specs. Audit mode's 0.02
      // gives 14.09. Opt in with `bun run visual:audit`; the default path is unchanged.
      threshold: AUDIT ? 0.02 : 0.2,
    },
  },
```

The default branch states `0.2` explicitly even though it is Playwright's own default. Part of
why the blind spot survived is that the config was silent about the comparator, so no reader
had cause to ask what the number was. Do not delete it as redundant.

- [ ] **Step 2: Add the package script**

In `package.json`, add `visual:audit` immediately after the existing `"shoot"` line:

```json
    "shoot": "playwright test --update-snapshots",
    "visual:audit": "VISUAL_AUDIT=1 playwright test",
```

- [ ] **Step 3: Typecheck and lint**

```bash
bun run typecheck && bun run lint
```

Expected: both pass.

- [ ] **Step 4: Calibrate — measure anti-aliasing noise**

This is the one number the design could not settle from the desk. With no source changes at
all, run the full suite in audit mode twice and record the failure counts:

```bash
bun run visual:audit 2>&1 | tail -20
bun run visual:audit 2>&1 | tail -20
```

Expected: **5 failed**, all of them `DebugApp` specs (the live uptime counter).

Record both counts and the names of any non-`DebugApp` failures in your report — this is the
task's primary finding, not an incidental check.

**If more than the 5 `DebugApp` failures appear**, anti-aliasing noise is real. The remedy is
to add a `maxDiffPixelRatio` just above the measured noise floor, inside the same
`toHaveScreenshot` block — for example, if the noisiest non-`DebugApp` spec differed by 0.02%
of its pixels:

```typescript
    toHaveScreenshot: {
      threshold: AUDIT ? 0.02 : 0.2,
      // Measured anti-aliasing floor in audit mode; see the plan's calibration step.
      ...(AUDIT ? { maxDiffPixelRatio: 0.0005 } : {}),
    },
```

Use the conditional-spread form shown rather than `maxDiffPixelRatio: AUDIT ? 0.0005 :
undefined`. Both compile, and Playwright treats an explicit `undefined` as absent, so this is a
readability choice: the spread leaves the default path carrying no key at all, which keeps the
"default behaviour is untouched" guarantee visible in the source.

Derive the actual number from the reported diff-pixel counts rather than copying `0.0005`, and
state in your report which spec set it. **Do not raise `threshold` instead** — a pixel-count
floor keeps full per-pixel color sensitivity and merely tolerates scattered pixels, whereas a
looser threshold reinstates exactly the blindness this task exists to remove. A real token
change lights up thousands of pixels and clears any sane ratio floor.

- [ ] **Step 5: Prove audit mode catches what the default misses**

Ensure Storybook is running (`curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:6006/index.json`
returns `200`; start it with `bun storybook` if not).

Edit `client/shared/tokens.css` line 21, reverting `--text-dim` to sub-project G's pre-fix
value — a YIQ delta of 264.7 against the current value:

```css
--text-dim: #6b766e; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */
```

Run the same spec twice, once per mode:

```bash
bunx playwright test tests/visual/admin/components/AdminTopBar.spec.ts
bun run visual:audit tests/visual/admin/components/AdminTopBar.spec.ts
```

Expected: the first reports **`1 passed`** — 264.7 is far below the default cutoff of 1408.6.
The second reports **`1 failed`**. Same code, same baseline, two comparators, opposite
verdicts: that difference is the entire deliverable.

- [ ] **Step 6: Revert and confirm the default path is undisturbed**

```bash
git checkout -- client/shared/tokens.css
git diff --stat client/shared/tokens.css
```

Expected: no output.

Then run the full suite with no `VISUAL_AUDIT`:

```bash
bunx playwright test 2>&1 | tail -20
```

Expected: **449 passed, 5 failed** (the `DebugApp` uptime flakes) — the known floor, unchanged
by this task.

- [ ] **Step 7: Confirm the working tree contains only the intended changes**

```bash
git status --porcelain
```

Expected exactly:

```
 M package.json
 M playwright.config.ts
```

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add playwright.config.ts package.json
git commit -m "feat(visual): add opt-in high-sensitivity screenshot audit mode"
```

---

## Task 3: Documentation

`docs/architecture/storybook-screenshots.md` currently asserts that regression testing is out
of scope. Audit mode makes that conditionally false, and a claim that contradicts a shipped
script misleads the next reader.

**Files:**

- Modify: `docs/architecture/storybook-screenshots.md`

**Interfaces:**

- Consumes: the `visual:audit` script from Task 2 and its `VISUAL_AUDIT=1` convention; the
  per-run regeneration behaviour from Task 1; and Task 2 Step 4's calibration result.

### Steps

- [ ] **Step 1: Replace the out-of-scope claim**

In the "What is and isn't committed" section, replace this bullet:

```markdown
- Gitignored: `.storybook-shots/` (baselines + run artifacts), `playwright-report/`,
  `crvy-rprtr.*`. Screenshot regression testing is intentionally out of scope; the
  baselines are just the latest render.
```

with:

```markdown
- Gitignored: `.storybook-shots/` (baselines + run artifacts), `playwright-report/`,
  `crvy-rprtr.*`. Baselines are local artifacts and are never compared across sessions or in
  CI — by default they are just the latest render. For a deliberate cross-cutting change they
  can be used as a within-session regression check; see "Audit mode" below.
```

- [ ] **Step 2: Add the audit-mode section**

Insert this section immediately after "What is and isn't committed":

````markdown
## Audit mode

Reach for this when a single change is expected to affect many components at once — a design
token sweep, a shared-component edit — and you want the pass/fail partition to be evidence
about which components the change reached.

    bun run visual:audit            # whole suite
    bun run visual:audit tests/visual/admin/components/AdminTopBar.spec.ts   # one spec

It runs the normal suite with `VISUAL_AUDIT=1`, which drops the pixelmatch threshold from
Playwright's default `0.2` to `0.02`. The per-pixel cutoff is `35215 × threshold²`, so that is
a move from 1408.6 to 14.09. At the default, a dim-on-dark color change under roughly 1400 YIQ
delta passes silently: sub-project G's `--fg3` change measured 264.7 and was invisible to all
111 specs, which is why audit mode exists.

**The baselines must predate the change under test.** Audit mode compares against whatever is
in `.storybook-shots/`, so the workflow is: run the suite (or `bun shoot`) *before* editing,
make the change, then run `bun run visual:audit`. Running `bun shoot` after the edit
overwrites the evidence.

**What a green audit proves:** the render matches the baseline. **What it does not prove:**
that the baseline was ever right. Audit mode is a change-detector, not a correctness oracle.

`DebugApp` carries a live uptime counter and fails on every run in both modes. It is a known
false positive.
````

- [ ] **Step 3: Note per-run CSS regeneration in "The loop"**

Append this paragraph to the end of the "The loop" section, after the numbered steps:

```markdown
Editing `client/shared/tokens.css` or any `client/**/*.css` needs no Storybook restart: those
files are concatenated into `public/storybook-*.css`, and a Playwright `globalSetup`
regenerates them at the start of every run (~112 ms). Before that existed, a warm Storybook
served the CSS snapshot it booted with, and runs silently rendered stale tokens.
```

- [ ] **Step 4: Record the calibration outcome**

If Task 2 Step 4 required a `maxDiffPixelRatio`, add one sentence to the "Audit mode" section
naming the value and the spec that set it. If calibration came back clean at the 5 `DebugApp`
failures, add nothing — do not document a setting that does not exist.

- [ ] **Step 5: Format and verify**

```bash
bun run format
bun run license:headers
git diff --stat
```

Expected: only `docs/architecture/storybook-screenshots.md` is modified. If `license:headers`
reports changes to unrelated files, revert those — the script is known to be non-idempotent
and that is tracked separately.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/storybook-screenshots.md
git commit -m "docs(visual): document audit mode and per-run CSS regeneration"
```

- [ ] **Step 7: Run the full repo gate**

The spec requires this before the cycle closes:

```bash
bun run check:full
```

Expected: **12/12 checks passed**.

This is the last step of the plan, so run it on the final tree with all three commits in
place. If a check fails, report the failing check's name and output verbatim; do not attempt a
broad fix without reporting first, and do not conclude "unrelated" without re-running the
named suite in isolation to confirm it.

---

## Notes for the implementer

**The experiments are the tests.** This plan changes Playwright configuration, which has no
meaningful unit to assert against — a test that reads the config back and asserts
`0.02 === 0.02` would be test-shaped noise. Task 1 Steps 3/7/8 and Task 2 Step 5 are the
verification, and each is structured as a genuine red/green pair. Do not substitute a
mock-based test for them, and do not skip the red step: a green step that was never preceded
by a red one proves only that the suite passes, which it did before you started.

**The write hooks do not gate this work.** `enforceTdd` in `.claude/hooks/pre-tool-use.mjs`
only applies to files under `src/`, `client/`, `plugins/`, or `review-loop/src/`;
`playwright.config.ts`, `tests/**`, `package.json`, and `docs/**` are all exempt. You do not
need an accompanying test file, and you must not add a lint-suppression comment to work around
a hook that will not fire.

**Storybook must stay warm across Task 1.** The whole point of Steps 3 and 7 is that the server
outlived the CSS edit. If you restart it between them, both steps pass for the wrong reason and
the task proves nothing.

**Never run `bun shoot` in this plan.** It is `playwright test --update-snapshots`, and it
would overwrite the baselines every experiment compares against. Note also that
`--update-snapshots` consumes a positional argument, so `bun shoot <path>` misbehaves; the
`-g <pattern>` form is the correct one when you do need it — which, here, you do not.

**Report Task 2 Step 4's numbers even when they are boring.** The calibration result is the
finding, and "5 failures, all `DebugApp`, both runs" is a valid and valuable answer.
