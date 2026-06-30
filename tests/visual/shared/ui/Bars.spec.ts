// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/Bars', () => {
  test('Default', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-bars--default')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Flat', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-bars--flat')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Single bar', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-bars--single-bar')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty edge', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-bars--empty-edge')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('fluid', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-bars--fluid')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
