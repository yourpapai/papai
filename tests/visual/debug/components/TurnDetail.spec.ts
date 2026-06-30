// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('debug/components/TurnDetail', () => {
  test('Completed', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-turndetail--completed')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Errored', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-turndetail--errored')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Running', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'debug-components-turndetail--running')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
