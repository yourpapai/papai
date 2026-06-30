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

2.  (Re)generate visual specs after adding or renaming stories. This also
    auto-formats and license-stamps the generated specs, so the tree stays green:

        bun shoot:gen

3.  Capture screenshots for the stories you care about (`-g` is a regex over
    test titles / story names):

        bun shoot -g ToolsSection

4.  Read the baseline PNGs under `.storybook-shots/` (mirrors the story tree —
    one stable file per story, named `<story-id>-<n>.png`), e.g.:

        .storybook-shots/settings/sections/ToolsSection.spec.ts/settings-sections-ToolsSection-Populated-1.png

    (Ignore the sibling `.storybook-shots/test-results/` dir — those `…-actual.png`
    files are transient per-run artifacts, not the stable render.)

5.  Edit the component, then re-run `bun shoot -g <name>`. HMR + the
    `reuseExistingServer` Playwright `webServer` keep re-shoots fast.

## Capturing intermediate states

`strybk` regenerates the `@generated-begin auto-screenshots` region but
preserves the manual region below `// @generated-end auto-screenshots`. Add
interaction steps there and shoot:

    // manual region (below @generated-end)
    test('Tools — domain expanded', async ({ sharedPage }) => {
      await switchStory(sharedPage, 'settings-sections-toolssection--populated')
      await sharedPage.getByText('tasks').click()
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
