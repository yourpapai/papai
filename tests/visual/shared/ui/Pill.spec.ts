// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Pill', () => {
  test('Neutral', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-pill--neutral')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Accent with dot', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-pill--accent-with-dot')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Warn with dot', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-pill--warn-with-dot')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Danger', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-pill--danger')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Info', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-pill--info')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
