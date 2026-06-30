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
    reuseExistingServer: true, // warm loop: reuse a Storybook already running
    timeout: 120_000,
  },
})
