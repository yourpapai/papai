// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { defineConfig, devices } from '@playwright/test'

const STORYBOOK_URL = 'http://localhost:6006'
const AUDIT = process.env['VISUAL_AUDIT'] === '1'

export default defineConfig({
  testDir: 'tests/visual',
  // Baselines double as the agent's "current render": gitignored and rewritten by
  // `bun shoot`, which passes `--update-snapshots=all`. The bare flag presets to mode
  // "changed", which only rewrites baselines the comparator already considers different —
  // that silently strands sub-threshold drift, so do not drop the `=all`.
  // {testFilePath} mirrors the story tree and {arg} is the story name, so PNGs are easy
  // to locate by hand.
  snapshotPathTemplate: '.storybook-shots/{testFilePath}/{arg}{ext}',
  outputDir: '.storybook-shots/test-results',
  // Regenerates public/storybook-*.css per run. A warm server would otherwise serve the
  // token snapshot it booted with — see the module's doc comment.
  globalSetup: './tests/visual/support/global-setup.ts',
  fullyParallel: true,
  reporter: [
    ['list'],
    // Optional review/approval DX. Remove this single line to drop rprtr.
    ['@crvy/rprtr', { screenshotDir: '.storybook-shots' }],
  ],
  use: {
    baseURL: STORYBOOK_URL,
    // Timestamps render in local time. Without a pinned zone the same fixture produces a
    // different baseline on every machine and in CI.
    timezoneId: 'UTC',
  },
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
  webServer: {
    command: 'bun storybook',
    url: `${STORYBOOK_URL}/index.json`,
    // warm loop: reuse a Storybook already running
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
