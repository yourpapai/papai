// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/components/DebugDetailRail', () => {
  test('Empty', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-debugdetailrail--empty')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Turn selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-debugdetailrail--turn-selected')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Trace selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-debugdetailrail--trace-selected')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Session selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-debugdetailrail--session-selected')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Failure selected', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-debugdetailrail--failure-selected')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
