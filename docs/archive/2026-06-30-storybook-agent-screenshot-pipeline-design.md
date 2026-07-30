<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook → Agent Screenshot Feedback Pipeline

**Date:** 2026-06-30
**Status:** Design — approved for planning
**Topic:** A comfort pipeline that lets a local Claude Code session render `client/` Storybook stories, capture screenshots, and read them back in-session so the agent can _see_ the UI it is editing and iterate on UI/UX.

## 1. Problem & Goal

The agent editing `client/` components is blind to the rendered result. It can read code and run unit/DOM tests, but it cannot see layout, spacing, overflow, contrast, or visual regressions. The goal is a low-friction loop:

> edit a component → run one command → read the resulting PNG(s) in-session → assess → iterate.

The consumer is a **local Claude Code session** (terminal/IDE), which ingests PNGs directly via the Read tool. No transport layer or remote (ACP/magi) session is involved. Screenshot _regression testing_ (committed baselines + diff gating) is explicitly **out of scope** for this phase; we want the agent to view the _current_ render, not police it against a baseline.

### Non-goals (YAGNI)

- Visual-regression diffing / approval gating in CI.
- Chromatic or any hosted visual service.
- Cross-browser capture (chromium only).
- Exhaustive theme/viewport matrices (the mechanism supports them; we do not enumerate them now).
- Backfilling stories for all 39 settings components (a documented subset is the fuel; the rest is backlog).

## 2. Current State (findings)

**Storybook is mature.** `@storybook/svelte-vite` 9 + `@storybook/addon-svelte-csf` + `@storybook/addon-a11y` + `msw-storybook-addon`, with a real fixtures system under `client/stories/`:

- `client/stories/decorators/withFixtures.ts` — `fixturesLoader` runs before each story: resets rune singletons, clears SSE, registers the scenario's MSW handlers (keyed by `parameters.fixtures`), seeds SSE.
- `client/stories/msw/{handlers,scenarios}.ts` — MSW handler groups and named scenarios.
- `client/stories/stubs/{sse,intersection-observer}.ts` — browser-API stubs installed in `preview.ts`.
- `client/stories/fixtures/{index,debug,schemas}.ts` — fixtures with a boot-time `assertFixturesMatchSchemas()` drift guard.

**Coverage is lopsided:**

| Area        | Components | Stories |
| ----------- | ---------: | ------: |
| `shared/`   |         38 |      35 |
| `admin/`    |         13 |      13 |
| `debug/`    |         16 |      16 |
| `settings/` |         39 |   **0** |

The **settings SPA** — which `CLAUDE.md` calls out as _"where ALL configuration happens"_ — has zero coverage. That is the biggest content gap and the natural fuel for the pipeline.

**Settings data-loading pattern.** Most settings sections (`ReposSection`, `ByokSection`, `KaneoAccessSection`, `MembersSection`, `AdminUsersSection`, …) accept only `contextId` and call **module-level fetchers** that hit `/settings/api/…`. They do _not_ expose dependency-injection props. `ToolsSection` is the exception (it exposes `fetchToolsFn?` etc.). **Implication:** settings stories must be **MSW-driven** (consistent with the admin/debug pattern); DI props are an occasional escape hatch, not the norm.

**Repo tooling facts that constrain the design:**

- `bun test` discovery is scoped by `bunfig.toml [test] pathIgnorePatterns` (currently ignores `tests/e2e/**`, `tests/client/**`). Bun's runner matches `*.spec.*` files, so Playwright specs must be excluded here or they collide.
- Storybook emits a story index at `/index.json` (dev server) and into `storybook-static/`.
- `storybook:prepare` already runs `msw init public/` (the MSW service worker is in place for the real browser Storybook that Playwright drives).
- `bun build:client` is entrypoint-based; `bun check:bundle-isolation` guards the client bundle. Loose `.ts` test files outside the entrypoint graph are not bundled, but specs should live outside `client/` to keep the surface clean.
- Runtime is Bun 1.3.13. The Playwright **test runner** ships its own Node runtime via the `playwright` binary, so it runs regardless of Bun being the project runtime.

## 3. Chosen Approach

Use **`@crvy/strybk`** (by the same author as this repo's toolchain) as the generator-first capture engine, with **`@crvy/rprtr`** included as an optional, easily-dropped Playwright reporter for later screenshot-review DX.

### Why strybk over a hand-rolled Playwright script

`strybk` already solves the hard parts we would otherwise build by hand:

- Reads Storybook `/index.json`, groups stories by story file, and **generates one `.spec.ts` per story file**. Each test does `switchStory(sharedPage, id)` → `expect(sharedPage).toHaveScreenshot()`.
- `switchStory` drives the **Storybook preview channel** on a shared per-worker page (no full reload), which **re-runs each story's loaders** — so our existing `fixturesLoader` + MSW scenarios work unchanged.
- Auto-injects animation-disabling CSS and resets scroll/cursor for deterministic shots (so we do **not** add a custom animation decorator).
- Supports per-Playwright-project Storybook globals via `project.metadata.storybookGlobals` (theme/viewport matrices available later at zero extra design cost).
- Generates each spec with a regenerated `@generated-begin auto-screenshots` region **plus a preserved manual region** below it — the seam where the agent adds interaction steps to capture intermediate states.

`strybk` therefore owns Section 4 (capture). Our work is the configuration and repo integration around it, plus the story fuel.

## 4. Capture Pipeline

### 4.1 `strybk.config.ts` (repo root)

```ts
import { defineConfig } from '@crvy/strybk'
import path from 'node:path'

export default defineConfig({
  storybookUrl: 'http://localhost:6006',
  storyGlobs: ['client/**/*.stories.svelte'],
  // Mirror story path under tests/visual/, committed as the test foundation.
  // e.g. client/settings/sections/ToolsSection.stories.svelte
  //   ->  tests/visual/settings/sections/ToolsSection.spec.ts
  resolveSpecPath: ({ storyFilePath }) => {
    const rel = path.relative(path.join(process.cwd(), 'client'), storyFilePath)
    return path.join('tests/visual', rel.replace(/\.stories\.svelte$/, '.spec.ts'))
  },
})
```

`deleteOrphans` (default `true`) prunes specs whose stories were removed. The `@generated` region is regenerated; the manual region is preserved across regenerations.

### 4.2 `playwright.config.ts` (repo root)

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/visual',
  // Baselines double as the agent's "current render" because they are
  // gitignored and always (re)written via --update-snapshots. Predictable,
  // flat-ish layout so the agent can find PNGs without parsing a tree.
  snapshotPathTemplate: '.storybook-shots/{testFilePath}/{arg}{ext}',
  outputDir: '.storybook-shots/test-results',
  reporter: [
    ['list'],
    // Optional review/approval DX; drop this line to remove rprtr entirely.
    ['@crvy/rprtr', { screenshotDir: '.storybook-shots' }],
  ],
  use: {
    baseURL: 'http://localhost:6006',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        /* devices['Desktop Chrome'] */
      },
    },
  ],
  webServer: {
    command: 'bun storybook',
    url: 'http://localhost:6006/index.json',
    reuseExistingServer: true, // warm loop: reuse a Storybook already running
    timeout: 120_000,
  },
})
```

Notes:

- `reuseExistingServer: true` is the comfort lever: if the agent already has `bun storybook` running, re-shoots are near-instant (HMR-fresh); otherwise Playwright boots one and waits on `/index.json`.
- `--update-snapshots` makes every run (re)write baselines = the current render. With baselines gitignored there is never a "diff failure" to fight; the agent just reads the freshest PNG.
- Exact device/viewport and any theme matrix are implementation details (Playwright projects + `storybookGlobals`); start with a single desktop chromium project.

### 4.3 Generated spec shape

```ts
import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('settings/sections/ToolsSection', () => {
  test('Populated', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-toolssection--populated')
    await expect(sharedPage).toHaveScreenshot()
  })
  // ...one per story (Loading / Empty / Error / variants)
})
// @generated-end auto-screenshots

// Manual region: agent-authored interaction tests for intermediate states,
// e.g. open the confirm modal, reveal a secret, focus a field, then shoot.
```

### 4.4 Agent loop

1. One-time: `bunx playwright install chromium`.
2. After adding/refreshing stories: `bun shoot:gen` (regenerates `tests/visual/**` specs from the story index).
3. Shoot: `bun shoot -g ToolsSection` → Playwright boots/reuses Storybook, writes PNGs under `.storybook-shots/…`.
4. The agent **Reads** the PNG(s) and assesses the render.
5. Edit the component → `bun shoot -g ToolsSection` again (HMR-fresh) → re-Read → iterate.
6. For intermediate states, the agent adds steps to the spec's **manual region**, then re-shoots.

## 5. Story Fuel (representative subset)

strybk only generates specs for stories that exist, so a settings backfill is required to give the pipeline meaningful targets. Scope to a **representative subset** that exercises every settings UI pattern; the remaining ~33 sections are a documented backlog the same pipeline later covers.

### 5.1 State taxonomy

Per section, author the states that apply:

- **Core:** `Loading`, `Empty`, `Populated`, `Error`.
- **Variant (where applicable):** secret masked vs revealed; confirm/destructive modal open; admin-gated vs not; guest vs member; edit-in-progress / dirty field.

### 5.2 Subset (one per pattern)

| Pattern             | Component            | Notes                                        |
| ------------------- | -------------------- | -------------------------------------------- |
| CRUD table          | `ReposSection`       | list / add / delete rows                     |
| Permission control  | `ToolsSection`       | segmented allow/ask/deny; also has DI props  |
| Secret/credential   | `ByokSection`        | masked vs revealed secret, toggle enabled    |
| Read-mostly panel   | `KaneoAccessSection` | reveal-password interaction                  |
| Admin-gated section | `AdminUsersSection`  | role/visibility gating                       |
| Full-page shell     | `SettingsApp`        | sidebar + active section, full-screen layout |

### 5.3 Data-driving the stories

Drive states via **MSW scenarios** (the established admin/debug pattern), since these sections fetch through module-level fetchers against `/settings/api/…`:

- Add settings MSW handler groups + named scenarios in `client/stories/msw/{handlers,scenarios}.ts` (e.g. `settings-repos-populated`, `settings-byok-empty`, `settings-tools-error`).
- Stories select them with `parameters={{ fixtures: '<scenario>' }}`, matching existing usage.
- Use DI props only where a section exposes them (e.g. `ToolsSection.fetchToolsFn`) and MSW would be awkward.

### 5.4 Required fixtures-loader fix

`fixturesLoader`'s `resetAllSingletons()` currently resets only `adminState` / `adminGlobals`. The settings SPA uses `settingsSession` / `activeContext` runes (`client/settings/session.svelte.ts`). Without resetting these, settings stories leak state across renders. **Extend the reset** (or add a settings-aware reset path) to cover them, mirroring the admin reset.

## 6. Repo Integration (setup changes)

1. **Dependencies (dev):** `@playwright/test`, `@crvy/strybk`, and (optional) `@crvy/rprtr`. One-time `bunx playwright install chromium`.
2. **Bun test isolation:** add `tests/visual/**` to `bunfig.toml [test] pathIgnorePatterns` so Bun's runner ignores Playwright specs.
3. **New config files:** `strybk.config.ts`, `playwright.config.ts` (Section 4).
4. **`.gitignore`:** `.storybook-shots/` (baselines + `test-results/`), `playwright-report/`, `crvy-rprtr.html`, `crvy-rprtr-*.json`. Generated **specs** under `tests/visual/` are **committed** (the reusable test foundation); only artifacts are ignored.
5. **Scripts (`package.json`):**
   - `"shoot:gen": "crvy-strybk generate --config ./strybk.config.ts"`
   - `"shoot": "playwright test --update-snapshots"` (accepts `-g <grep>` and a story path).
6. **Tooling sanity:** confirm `tests/visual/` is clean under `bun check:bundle-isolation`, `bun knip` (the visual specs + their `@crvy/*` imports must not be flagged as unused — add to knip entry config if needed), and `oxlint`.
7. **MSW & loaders:** no Storybook config change beyond the new settings scenarios; the service worker is already initialized by `storybook:prepare`, and channel-driven story switching re-runs loaders.
8. **Agent workflow doc:** a short `docs/` page (and optionally a local slash skill) describing the loop in Section 4.4, the selector/grep syntax, where PNGs land, and how to extend a spec's manual region for intermediate states.

## 7. Risks & Open Questions

- **strybk/rprtr maturity:** both are small, recent packages by the repo's own toolchain author. The plan should pin versions and smoke-test `generate` + one `toHaveScreenshot()` end-to-end before scaling out stories.
- **knip strictness:** `bun knip --strict` may flag generated specs or the `@crvy/*` deps; resolve via knip entry/ignore config, not lint-disables.
- **Loader re-run assumption:** verified by design (channel `selectStory` re-renders + re-runs loaders); confirm empirically during the first end-to-end smoke test that MSW-backed settings stories capture in their populated state (network-idle settle may need a small `waitFor`).
- **Snapshot naming:** confirm `snapshotPathTemplate` yields stable, predictable paths the agent can target; adjust the template if the default per-project/platform suffixes make Read targeting awkward.

## 8. Definition of Done

- `bun shoot:gen` generates committed specs under `tests/visual/` for all existing `client/**` stories.
- `bun shoot -g <name>` boots/reuses Storybook and writes readable PNGs under `.storybook-shots/`.
- The 6-section settings subset (Section 5.2) has stories covering the applicable state taxonomy, MSW-driven, with the fixtures-loader reset fix in place.
- `bun test`, `bun check:bundle-isolation`, `bun knip`, and `oxlint` remain green with the new files present.
- A `docs/` page documents the agent loop; `@crvy/rprtr` is wired but trivially removable.
