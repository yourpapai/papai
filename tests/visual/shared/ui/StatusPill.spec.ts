// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { test, expect, switchStory } from '@crvy/strybk'

// @generated-begin auto-screenshots
test.describe('shared/ui/StatusPill', () => {
  test('Active', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--active')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Pending', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--pending')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Auto', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--auto')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Unmatched', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--unmatched')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Failed', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--failed')
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Unknown', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'shared-ui-statuspill--unknown')
    await expect(sharedPage).toHaveScreenshot()
  })
})
// @generated-end auto-screenshots
