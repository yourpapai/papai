<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook → Agent Screenshot Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a local Claude Code session a one-command loop that renders `client/` Storybook stories, captures PNG screenshots, and writes them to a predictable folder the agent reads in-session — so it can see and iterate on the UI it edits.

**Architecture:** `@crvy/strybk` reads Storybook's `/index.json` and generates one Playwright `.spec.ts` per story file under `tests/visual/`; each test drives the Storybook preview channel (`switchStory`, which re-runs our existing MSW `fixturesLoader`) and calls Playwright's `toHaveScreenshot()`. Baselines are written to a gitignored `.storybook-shots/` dir via `--update-snapshots`, so they are simply "the current render" for the agent to read — screenshot regression testing is out of scope. `@crvy/rprtr` is wired as an optional, trivially-removable reporter for later review DX.

**Tech Stack:** Bun 1.3.13, Storybook 9 (`@storybook/svelte-vite` + `addon-svelte-csf` + `msw-storybook-addon`), Playwright (`@playwright/test`), `@crvy/strybk`, `@crvy/rprtr`.

**Spec:** `docs/superpowers/specs/2026-06-30-storybook-agent-screenshot-pipeline-design.md`

## Scope of this plan

**Delivers:** the complete capture pipeline (deps, `strybk.config.ts`, `playwright.config.ts`, scripts, gitignore, tooling integration), proven end-to-end by shooting an existing **MSW-backed admin story** (validates that channel-driven story switching re-runs our `fixturesLoader` + MSW under Playwright), plus the **first new settings story** (`ToolsSection`, driven by its dependency-injection props) as proof that new settings stories flow through the pipeline.

**Deferred to a follow-up plan** (`storybook-settings-story-backfill`): the remaining 5 representative settings sections (`ReposSection`, `ByokSection`, `KaneoAccessSection`, `AdminUsersSection`, the `SettingsApp` shell), the new **settings MSW handler groups + scenarios** those fetcher-based sections require, and the `fixturesLoader` reset extension for `settingsSession`/`activeContext`. Rationale: each fetcher-based section needs its own endpoint/schema research; the end-to-end pattern is fully proven by this plan, so the backfill becomes mechanical repetition of an established template.

---

## File Structure

| File                                                   | Responsibility                                                                                            | Created/Modified |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `strybk.config.ts`                                     | Tell strybk where Storybook is, which stories to scan, where to emit specs                                | Create           |
| `playwright.config.ts`                                 | testDir, baseURL, chromium project, snapshot/output paths, `webServer` auto-boot, optional rprtr reporter | Create           |
| `package.json`                                         | `shoot:gen` + `shoot` scripts; new devDeps                                                                | Modify           |
| `bunfig.toml`                                          | Exclude `tests/visual/**` from Bun's test discovery                                                       | Modify           |
| `knip.jsonc`                                           | Register the two root config files as entries; ignore `tests/visual/**`                                   | Modify           |
| `.gitignore`                                           | Ignore `.storybook-shots/`, `playwright-report/`, rprtr artifacts                                         | Modify           |
| `tests/visual/**/*.spec.ts`                            | strybk-generated visual specs (committed test foundation)                                                 | Generated        |
| `client/settings/sections/ToolsSection.stories.svelte` | First settings story; DI-driven states                                                                    | Create           |
| `docs/architecture/storybook-screenshots.md`           | Agent workflow doc                                                                                        | Create           |

---

## Task 1: Add dependencies, install chromium, and gitignore artifacts

**Files:**

- Modify: `package.json` (devDependencies)
- Modify: `.gitignore`

- [ ] **Step 1: Add the dev dependencies**

Run:

```bash
bun add -d @playwright/test @crvy/strybk @crvy/rprtr
```

Expected: `package.json` gains `@playwright/test`, `@crvy/strybk`, `@crvy/rprtr` under `devDependencies`; `bun.lock` updates.

- [ ] **Step 2: Install the chromium browser binary**

Run:

```bash
bunx playwright install chromium
```

Expected: Playwright downloads the chromium build (one-time; prints "chromium … downloaded" or "is already installed").

- [ ] **Step 3: Add artifact ignores to `.gitignore`**

Append to `.gitignore` (after the `# Storybook static build` block):

```gitignore
# Storybook screenshot pipeline (baselines + run artifacts are not committed;
# only the generated specs under tests/visual/ are version-controlled)
.storybook-shots/
playwright-report/
crvy-rprtr.html
crvy-rprtr-*.json
```

- [ ] **Step 4: Verify the browser is runnable and nothing is staged yet**

Run:

```bash
bunx playwright --version
git status --short
```

Expected: prints a Playwright version (e.g. `Version 1.x.x`); `git status` shows modified `package.json`, `bun.lock`, `.gitignore`.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock .gitignore
git commit -m "chore(storybook): add playwright + crvy screenshot deps and ignore artifacts"
```

---

## Task 2: Author `strybk.config.ts`

**Files:**

- Create: `strybk.config.ts`

- [ ] **Step 1: Write the config**

Create `strybk.config.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { defineConfig } from '@crvy/strybk'

const CLIENT_ROOT = path.join(process.cwd(), 'client')

export default defineConfig({
  storybookUrl: 'http://localhost:6006',
  storyGlobs: ['client/**/*.stories.svelte'],
  // Mirror each story's path under tests/visual/ as a committed .spec.ts.
  // client/settings/sections/ToolsSection.stories.svelte
  //   -> tests/visual/settings/sections/ToolsSection.spec.ts
  resolveSpecPath: ({ storyFilePath }) => {
    const rel = path.relative(CLIENT_ROOT, storyFilePath)
    return path.join('tests/visual', rel.replace(/\.stories\.svelte$/u, '.spec.ts'))
  },
})
```

- [ ] **Step 2: Verify it type-checks and imports resolve**

Run:

```bash
bunx tsgo --noEmit strybk.config.ts
```

Expected: no errors (the `@crvy/strybk` `defineConfig` export resolves).

- [ ] **Step 3: Commit**

```bash
git add strybk.config.ts
git commit -m "feat(storybook): add strybk config for spec generation"
```

---

## Task 3: Author `playwright.config.ts`

**Files:**

- Create: `playwright.config.ts`

- [ ] **Step 1: Write the config**

Create `playwright.config.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { defineConfig, devices } from '@playwright/test'

const STORYBOOK_URL = 'http://localhost:6006'

export default defineConfig({
  testDir: 'tests/visual',
  // Baselines double as the agent's "current render": gitignored and always
  // (re)written via `--update-snapshots`. {testFilePath} mirrors the story tree
  // and {arg} is the story name, so PNGs are easy to locate by hand.
  snapshotPathTemplate: '.storybook-shots/{testFilePath}/{arg}{ext}',
  outputDir: '.storybook-shots/test-results',
  fullyParallel: true,
  reporter: [
    ['list'],
    // Optional review/approval DX. Remove this single line to drop rprtr.
    ['@crvy/rprtr', { screenshotDir: '.storybook-shots' }],
  ],
  use: {
    baseURL: STORYBOOK_URL,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun storybook',
    url: `${STORYBOOK_URL}/index.json`,
    // warm loop: reuse a Storybook already running
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

- [ ] **Step 2: Verify it type-checks**

Run:

```bash
bunx tsgo --noEmit playwright.config.ts
```

Expected: no errors (`@playwright/test` and `@crvy/rprtr` resolve).

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "feat(storybook): add playwright config targeting storybook iframe"
```

---

## Task 4: Wire scripts, Bun test isolation, and knip

**Files:**

- Modify: `package.json` (scripts)
- Modify: `bunfig.toml`
- Modify: `knip.jsonc`

- [ ] **Step 1: Add the two scripts to `package.json`**

In the `"scripts"` object, after the existing `"build:storybook"` line, add:

```json
    "shoot:gen": "crvy-strybk generate --config ./strybk.config.ts",
    "shoot": "playwright test --update-snapshots",
```

- [ ] **Step 2: Exclude visual specs from Bun's test runner**

In `bunfig.toml`, change the `[test]` `pathIgnorePatterns` line from:

```toml
pathIgnorePatterns = ["tests/e2e/**", "tests/client/**"]
```

to:

```toml
pathIgnorePatterns = ["tests/e2e/**", "tests/client/**", "tests/visual/**"]
```

- [ ] **Step 3: Register config files and ignore `tests/visual` in `knip.jsonc`**

In `knip.jsonc`, add the two root config files to the `entry` array (after the `scripts/behavior-audit/*` entries):

```jsonc
    "playwright.config.ts!",
    "strybk.config.ts!",
```

And in the `ignore` array, add `tests/visual/**` alongside `client/stories/**`:

```jsonc
  "ignore": ["src/db/migrations/**", "client/stories/**", "tests/visual/**"],
```

- [ ] **Step 4: Verify the `bunfig.toml` edit is in place**

Run:

```bash
grep pathIgnorePatterns bunfig.toml
```

Expected: the line now includes `"tests/visual/**"` alongside the e2e/client entries. (Full `bun test` runs in Final verification.)

- [ ] **Step 5: Verify knip is green**

Run:

```bash
bun knip
```

Expected: `0` issues. The new `@playwright/test`, `@crvy/strybk`, `@crvy/rprtr` deps are seen via the registered config entries; no "unused devDependency" errors.

- [ ] **Step 6: Commit**

```bash
git add package.json bunfig.toml knip.jsonc
git commit -m "chore(storybook): wire shoot scripts, bun-test isolation, knip"
```

---

## Task 5: Generate the visual specs from existing stories

This is an integration task (no unit test): `crvy-strybk generate` fetches `/index.json`, so Storybook must be running first.

**Files:**

- Generated: `tests/visual/**/*.spec.ts`

- [ ] **Step 1: Start Storybook in the background**

Run it detached (background) and leave it up for the next tasks — e.g. in a separate shell, or:

```bash
bun storybook > /tmp/storybook.log 2>&1 &
```

Wait until the log shows `Storybook … started` and `http://localhost:6006/` is reachable. Confirm the index is up:

```bash
curl -sf http://localhost:6006/index.json | head -c 80
```

Expected: a JSON blob beginning with `{"v":` and an `"entries"` object.

- [ ] **Step 2: Dry-run the generator to preview outputs**

Run:

```bash
bun shoot:gen --dry-run
```

Expected: prints `Generated N file(s) (dry run).` where N equals the number of `.stories.svelte` files under `client/` (currently ~64), and writes nothing.

- [ ] **Step 3: Generate the specs for real**

Run:

```bash
bun shoot:gen
```

Expected: prints `Generated N file(s).`; `tests/visual/` now mirrors the story tree (e.g. `tests/visual/admin/sections/BillingSection.spec.ts`, `tests/visual/shared/ui/Btn.spec.ts`).

- [ ] **Step 4: Sanity-check one generated spec**

Run:

```bash
sed -n '1,20p' tests/visual/admin/sections/BillingSection.spec.ts
```

Expected: imports `{ test, expect, switchStory } from '@crvy/strybk'`, a `@generated-begin auto-screenshots` region with `test('Populated', …)` calling `switchStory(sharedPage, 'admin-sections-billingsection--populated')` then `expect(sharedPage).toHaveScreenshot()`.

- [ ] **Step 5: Commit the generated specs**

```bash
git add tests/visual
git commit -m "feat(storybook): generate visual specs from existing stories"
```

---

## Task 6: Prove the end-to-end shoot (MSW-backed + plain stories)

Validates the riskiest assumption: channel-driven `switchStory` re-runs our `fixturesLoader` so MSW-backed stories capture in their populated (not loading/empty) state under Playwright.

**Files:** none (verification only)

- [ ] **Step 1: Shoot one MSW-backed admin story and one plain shared story**

With Storybook still running, run:

```bash
bun shoot -g "BillingSection|Btn"
```

Expected: Playwright reuses the running Storybook (no new server), runs the matched tests, prints each as `ok`/written, and exits 0. First run writes baselines (that is the intent under `--update-snapshots`).

- [ ] **Step 2: Confirm PNGs landed where the agent will read them**

Run:

```bash
find .storybook-shots -name '*.png' | head -20
```

Expected: PNG files under `.storybook-shots/admin/sections/BillingSection.spec.ts/…` and `.storybook-shots/shared/ui/Btn.spec.ts/…`.

- [ ] **Step 3: Verify the MSW-backed shot is populated, not blank/loading**

Open the BillingSection `Populated` PNG (an agent would Read it; a human opens it):

```bash
open "$(find .storybook-shots -path '*BillingSection*Populated*.png' | head -1)"
```

Expected: a populated billing table is visible (rows/values), confirming the loader + MSW ran before capture. If it is blank or a spinner, add a `await sharedPage.waitForLoadState('networkidle')` step inside the generated spec's manual region for that story and re-shoot — record this in the docs (Task 8) as the known settle remedy.

- [ ] **Step 4: Confirm artifacts are gitignored**

Run:

```bash
git status --short .storybook-shots
```

Expected: empty output (nothing staged — `.storybook-shots/` is ignored).

- [ ] **Step 5: No commit** (verification only; nothing to commit). Stop Storybook is not required — leave it running for Task 7.

---

## Task 7: First settings story — `ToolsSection` (DI-driven states)

`ToolsSection` exposes DI props (`fetchToolsFn`, etc.), so its states are driven without MSW. This proves new settings stories flow through generate → shoot.

**Files:**

- Create: `client/settings/sections/ToolsSection.stories.svelte`
- Generated (regenerated): `tests/visual/settings/sections/ToolsSection.spec.ts`

- [ ] **Step 1: Write the story with Loading / Empty / Populated / Error / Preset states**

Create `client/settings/sections/ToolsSection.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import type { ToolsResponse } from '../fetcher-schemas-tools.js'

  import ToolsSection from './ToolsSection.svelte'

  const CONTEXT_ID = 'tg:1'

  const populated: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [
      {
        domain: 'tasks',
        summary: 'allow',
        tools: [
          { name: 'createTask', permission: 'allow', risk: 'write' },
          { name: 'listTasks', permission: 'allow', risk: 'read' },
          { name: 'deleteTask', permission: 'ask', risk: 'destructive' },
        ],
      },
      {
        domain: 'web',
        summary: 'partial',
        tools: [{ name: 'webFetch', permission: 'ask', risk: 'open-world' }],
      },
    ],
  }

  const emptyResponse: ToolsResponse = {
    contextId: CONTEXT_ID,
    activePreset: null,
    hasStoredDefaults: false,
    domains: [],
  }

  const presetResponse: ToolsResponse = { ...populated, activePreset: 'read-only', hasStoredDefaults: true }

  // DI fixtures: each state is a fetchToolsFn returning the matching response.
  const fetchPopulated = (): Promise<ToolsResponse> => Promise.resolve(populated)
  const fetchEmpty = (): Promise<ToolsResponse> => Promise.resolve(emptyResponse)
  const fetchPreset = (): Promise<ToolsResponse> => Promise.resolve(presetResponse)
  const fetchNever = (): Promise<ToolsResponse> => new Promise<ToolsResponse>(() => {})
  const fetchError = (): Promise<ToolsResponse> => Promise.reject(new Error('Failed to load tools'))

  const { Story } = defineMeta({
    title: 'settings/sections/ToolsSection',
    component: ToolsSection,
    args: { contextId: CONTEXT_ID },
  })
</script>

<Story name="Populated" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchPopulated }} />

<Story name="Empty" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchEmpty }} />

<Story name="Preset applied" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchPreset, hasStoredDefaults: true }} />

<Story name="Loading" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchNever }} />

<Story name="Error" args={{ contextId: CONTEXT_ID, fetchToolsFn: fetchError }} />
```

- [ ] **Step 2: Verify the story appears in the Storybook index**

Storybook HMR picks up the new file. Confirm:

```bash
curl -sf http://localhost:6006/index.json | grep -o 'settings-sections-toolssection--[a-z-]*'
```

Expected: lists `settings-sections-toolssection--populated`, `--empty`, `--preset-applied`, `--loading`, `--error`.

- [ ] **Step 3: Regenerate specs to include the new story**

Run:

```bash
bun shoot:gen
```

Expected: prints `Generated N+1 file(s).`; `tests/visual/settings/sections/ToolsSection.spec.ts` now exists with five `test(...)` cases.

- [ ] **Step 4: Shoot the new settings story**

Run:

```bash
bun shoot -g ToolsSection
```

Expected: 5 tests run and pass (baselines written); exit 0.

- [ ] **Step 5: Verify the PNGs render the expected states**

Run:

```bash
find .storybook-shots -path '*ToolsSection*' -name '*.png'
open "$(find .storybook-shots -path '*ToolsSection*Populated*.png' | head -1)"
```

Expected: 5 PNGs; the `Populated` shot shows the `tasks`/`web` domains with allow/ask/deny segmented controls; the `Loading` shot shows the loading affordance; the `Error` shot shows "Failed to load tools".

- [ ] **Step 6: Confirm client checks remain green**

Run:

```bash
bun build:client && bun check:bundle-isolation && bun knip
```

Expected: build succeeds; bundle-isolation passes (the story is not bundled into `public/settings.js`); knip reports 0 issues.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/ToolsSection.stories.svelte tests/visual/settings/sections/ToolsSection.spec.ts
git commit -m "feat(storybook): add ToolsSection stories and generated visual spec"
```

---

## Task 8: Document the agent workflow

**Files:**

- Create: `docs/architecture/storybook-screenshots.md`
- Modify: `CLAUDE.md` (documentation index row)

- [ ] **Step 1: Write the workflow doc**

Create `docs/architecture/storybook-screenshots.md`:

```markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook screenshot pipeline (agent visual feedback)

A local Claude Code session can render any `client/` Storybook story, capture a
PNG, and read it back in-session to assess and iterate on the UI.

## One-time setup

    bunx playwright install chromium

## The loop

1.  Start Storybook once (kept warm for fast re-shoots):

    bun storybook

2.  (Re)generate visual specs after adding or renaming stories:

    bun shoot:gen

3.  Capture screenshots for the stories you care about (`-g` is a regex over
    test titles / story names):

        bun shoot -g ToolsSection

4.  Read the PNGs under `.storybook-shots/` (mirrors the story tree):

    .storybook-shots/settings/sections/ToolsSection.spec.ts/Populated-chromium.png

5.  Edit the component, then re-run `bun shoot -g <name>`. HMR + the
    `reuseExistingServer` Playwright `webServer` keep re-shoots fast.

## Capturing intermediate states

`strybk` regenerates the `@generated-begin auto-screenshots` region but
preserves the manual region below it. Add interaction steps there and shoot:

    // manual region
    test('Confirm modal open', async ({ sharedPage }) => {
      await switchStory(sharedPage, 'settings-sections-repossection--populated')
      await sharedPage.getByTestId('repos-delete').first().click()
      await expect(sharedPage).toHaveScreenshot()
    })

If an MSW-backed story captures blank/loading, add
`await sharedPage.waitForLoadState('networkidle')` before the assertion.

## What is and isn't committed

- Committed: generated specs under `tests/visual/**` (the reusable test foundation).
- Gitignored: `.storybook-shots/` (baselines + run artifacts), `playwright-report/`,
  `crvy-rprtr.*`. Screenshot regression testing is intentionally out of scope; the
  baselines are just the latest render.

## Optional review UI

`@crvy/rprtr` is wired in `playwright.config.ts`. Run `bunx crvy-rprtr` to open a
side-by-side review UI. Drop the reporter line from the config to remove it.
```

- [ ] **Step 2: Add a row to the `CLAUDE.md` documentation index**

In `CLAUDE.md`, in the "Documentation index" table, add a row after the `ACP coding sessions` row:

```markdown
| Storybook screenshots | [`docs/architecture/storybook-screenshots.md`](docs/architecture/storybook-screenshots.md) | agent visual-feedback loop: generate specs, shoot stories, read PNGs |
```

- [ ] **Step 3: Verify formatting and headers pass**

Run:

```bash
bun run format && bun run lint
```

Expected: both succeed; no license-header or format errors on the new markdown.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/storybook-screenshots.md CLAUDE.md
git commit -m "docs(storybook): document agent screenshot workflow"
```

---

## Final verification

- [ ] **Run the full staged check**

Stop the background Storybook, then run:

```bash
bun run check:full
```

Expected: lint, typecheck, format:check, knip, and the test suite all pass with the new files present.

- [ ] **Confirm the deliverable**

```bash
bun storybook   # in one shell
bun shoot:gen && bun shoot -g "Btn|ToolsSection"
find .storybook-shots -name '*.png' | wc -l
```

Expected: specs regenerate, shots run green, and PNGs exist — the pipeline is usable by the agent.
